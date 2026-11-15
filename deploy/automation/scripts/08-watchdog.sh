#!/bin/bash
# ---------------------------------------------------------------------------
# VoiceHub 看门狗：健康检查 + 自动恢复（systemd timer 调用，建议每 2 分钟）
# 覆盖五类故障：应用 HTTP 无响应、WAF 入口不可达、容器退出、内存占用过高、磁盘占用过高。
# 站点信息与告警凭据从外部文件读取，脚本内不含任何密钥。
# 部署与说明见 deploy/automation/README.md
# ---------------------------------------------------------------------------
VH_ENV_FILE=${VH_AUTOMATION_ENV:-/etc/voicehub/automation.env}
[ -r "$VH_ENV_FILE" ] && . "$VH_ENV_FILE"
VH_HOME=${VH_HOME:-/srv/voicehub}
set -uo pipefail

APP_URL=${VH_HEALTH_URL:-http://127.0.0.1:3000/api/health}
STATE_DIR=${VH_STATE_DIR:-/var/lib/voicehub-watchdog}
LOG="$VH_HOME/backups/watchdog.log"
MAIL=${VH_MAIL_BIN:-}
FAIL_FILE="$STATE_DIR/app-fail"
RESTART_AT_FILE="$STATE_DIR/last-restart"
MAX_FAILS=${VH_MAX_FAILS:-2}
COOLDOWN=${VH_RESTART_COOLDOWN:-300}
DISK_MAX=${VH_DISK_MAX_PERCENT:-90}
MEM_MAX=${VH_MEM_MAX_PERCENT:-85}
MEM_ALERT_COOLDOWN=${VH_MEM_ALERT_COOLDOWN:-1800}
MEM_ALERT_AT="$STATE_DIR/mem-alert-at"
# WAF 入口（经 tengine）探测：与应用直连互补，用于发现「应用活着但 WAF 挂了」的盲区
WAF_HOST=${VH_SITE_HOST:-}
if [ -z "$WAF_HOST" ] && [ -n "${VH_SITE_URL:-}" ]; then
  WAF_HOST=${VH_SITE_URL#https://}; WAF_HOST=${WAF_HOST#http://}; WAF_HOST=${WAF_HOST%%/*}
fi
WAF_URL=${VH_WAF_URL:-}
if [ -z "$WAF_URL" ] && [ -n "$WAF_HOST" ]; then WAF_URL="https://$WAF_HOST/api/health"; fi
WAF_FAIL_FILE="$STATE_DIR/waf-fail"
WAF_RESTART_AT_FILE="$STATE_DIR/waf-last-restart"
WAF_MAX_FAILS=${VH_WAF_MAX_FAILS:-3}
WAF_COOLDOWN=${VH_WAF_RESTART_COOLDOWN:-600}
SAFELINE_HOME=${VH_SAFELINE_HOME:-/data/safeline}
# 未恢复时以非 0 退出，让 systemctl status / 监控看到失败（日志与邮件之外的第二信号）
RC=0

TS=$(date '+%F %T')
if [ ! -d "$VH_HOME" ]; then
  printf '%s VH_HOME 不存在：%s，跳过恢复\n' "$TS" "$VH_HOME" >&2
  exit 1
fi
mkdir -p "$STATE_DIR" "$(dirname "$LOG")"
log() { printf '%s %s\n' "$TS" "$*" >> "$LOG"; }

notify() {
  [ -n "$MAIL" ] && [ -x "$MAIL" ] || return 0
  printf '%s\n' "$2" | "$MAIL" "$1" >/dev/null 2>&1 || true
}

state() { docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null; }
app_ok() { curl -fsS -m 5 -o /dev/null "$APP_URL"; }
# 经本地 tengine 走域名访问：--resolve 固定回源到 127.0.0.1，证书仍按域名校验
waf_ok() { curl -fsS -m 8 --resolve "$WAF_HOST:443:127.0.0.1" -o /dev/null "$WAF_URL"; }

# ---- 1) 应用存活：连续失败达阈值后重启（带冷却，防重启风暴）----
if app_ok; then
  prev=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
  [ "${prev:-0}" -ge "$MAX_FAILS" ] && log "应用恢复响应（此前连续失败 $prev 次）"
  echo 0 > "$FAIL_FILE"
else
  fails=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
  echo "$fails" > "$FAIL_FILE"
  log "健康检查失败：$APP_URL（连续 $fails 次）"
  if [ "$fails" -ge "$MAX_FAILS" ]; then
    now=$(date +%s)
    last=$(cat "$RESTART_AT_FILE" 2>/dev/null || echo 0)
    if [ $((now - last)) -lt "$COOLDOWN" ]; then
      log "距上次自动重启不足 ${COOLDOWN}s，跳过本次重启"
    else
      log "重启应用容器 voicehub"
      echo "$now" > "$RESTART_AT_FILE"
      case "$(state voicehub)" in
        running|restarting)
          docker restart voicehub >/dev/null 2>&1
          rc=$?
          ;;
        *)
          ( cd "$VH_HOME" && docker compose up -d voicehub ) >/dev/null 2>&1
          rc=$?
          ;;
      esac
      if [ "$rc" -ne 0 ]; then
        RC=1
        log "容器恢复命令失败（退出码 $rc）"
        notify "[VoiceHub] 自动恢复命令失败" "时间：$TS
命令退出码：$rc
请检查 docker 权限与 compose 文件"
      fi
      # 最长等待 120s：冷启动含依赖等待与迁移，短于 start_period 易误判失败
      for _ in $(seq 1 24); do
        sleep 5
        app_ok && break
      done
      if app_ok; then
        log "重启后恢复响应"
        echo 0 > "$FAIL_FILE"
        notify "[VoiceHub] 应用已自动重启恢复" "时间：$TS
连续失败：$fails 次
动作：docker restart voicehub
结果：健康检查通过"
      else
        RC=1
        log "重启后仍未恢复，需人工介入"
        notify "[VoiceHub] 应用自动重启失败" "时间：$TS
连续失败：$fails 次
动作：docker restart voicehub
结果：仍不可用，请登录主机检查 docker logs voicehub"
      fi
    fi
  fi
fi

# ---- 2) WAF 入口：应用直连健康但经 tengine 不可达时，判定为 WAF 层故障 ----
# 这是原脚本的盲区：健康检查直连 3000 端口，tengine 挂掉时仍报「健康」，而用户已无法访问。
if [ -n "$WAF_URL" ] && [ -n "$WAF_HOST" ]; then
  if waf_ok; then
    prev=$(cat "$WAF_FAIL_FILE" 2>/dev/null || echo 0)
    [ "${prev:-0}" -ge "$WAF_MAX_FAILS" ] && log "WAF 入口恢复可达（此前连续失败 $prev 次）"
    echo 0 > "$WAF_FAIL_FILE"
  else
    wf=$(( $(cat "$WAF_FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
    echo "$wf" > "$WAF_FAIL_FILE"
    # 只探测一次并复用结果，避免同一轮内多次请求拖长执行时间
    a_ok=0; app_ok && a_ok=1
    if [ "$a_ok" -eq 1 ]; then a_desc="健康"; else a_desc="异常"; fi
    log "WAF 入口不可达：$WAF_URL（连续 $wf 次；应用直连 $a_desc）"
    if [ "$wf" -ge "$WAF_MAX_FAILS" ]; then
      if [ "$a_ok" -ne 1 ]; then
        # 应用自身异常时由第 1 段负责恢复，此处不重复动作，避免双重重启
        log "应用直连同时异常，交由应用恢复逻辑处理，暂不重启 tengine"
      else
        now=$(date +%s)
        last=$(cat "$WAF_RESTART_AT_FILE" 2>/dev/null || echo 0)
        if [ $((now - last)) -lt "$WAF_COOLDOWN" ]; then
          log "距上次重启 tengine 不足 ${WAF_COOLDOWN}s，跳过本次重启"
        else
          log "应用健康但 WAF 不可达，重启 safeline-tengine"
          echo "$now" > "$WAF_RESTART_AT_FILE"
          if docker restart safeline-tengine >/dev/null 2>&1; then
            for _ in $(seq 1 12); do
              sleep 5
              waf_ok && break
            done
            if waf_ok; then
              echo 0 > "$WAF_FAIL_FILE"
              log "重启 tengine 后 WAF 恢复可达"
              notify "[VoiceHub] WAF 入口已自动重启恢复" "时间：$TS
连续失败：$wf 次
动作：docker restart safeline-tengine
结果：经 WAF 访问恢复 200"
            else
              RC=1
              log "重启 tengine 后仍不可达，需人工介入"
              notify "[VoiceHub] WAF 入口自动恢复失败" "时间：$TS
连续失败：$wf 次
动作：docker restart safeline-tengine
结果：仍不可达，请登录主机检查 docker logs safeline-tengine"
            fi
          else
            RC=1
            log "tengine 重启命令失败"
            notify "[VoiceHub] WAF 容器重启失败" "时间：$TS
容器：safeline-tengine
请检查 docker 权限与该容器状态"
          fi
        fi
      fi
    fi
  fi
fi

# ---- 3) 容器存活：非 running 时拉起（restart 策略之外的兜底）----
# 覆盖应用依赖与应用本体之外的网关组件；容器不存在时跳过（未安装该组件）
safeline_svc() {
  case "$1" in
    safeline-pg) echo postgres ;;
    safeline-mgt) echo mgt ;;
    safeline-detector) echo detect ;;
    safeline-tengine) echo tengine ;;
    safeline-chaos) echo chaos ;;
    safeline-luigi) echo luigi ;;
    safeline-fvm) echo fvm ;;
    *) echo "" ;;
  esac
}

for c in voicehub-postgres voicehub-redis voicehub-rewriter \
         safeline-tengine safeline-detector safeline-mgt \
         safeline-chaos safeline-pg safeline-luigi safeline-fvm; do
  st=$(state "$c")
  # 容器不存在（未安装）视为正常，不告警；只有「该有却没有/已退出」才是故障
  [ -z "$st" ] && continue
  case "$st" in
    running|restarting|created) ;;
    *)
      log "容器 $c 状态异常（${st:-不存在}），尝试拉起"
      # 先单容器 start，避免 compose up 连带拉起其他服务；start 失败再走对应 compose
      started=0
      if docker start "$c" >/dev/null 2>&1; then
        started=1
      else
        case "$c" in
          voicehub-*)
            ( cd "$VH_HOME" && docker compose up -d "${c#voicehub-}" ) >/dev/null 2>&1 && started=1
            ;;
          safeline-*)
            svc=$(safeline_svc "$c")
            if [ -n "$svc" ] && [ -f "$SAFELINE_HOME/docker-compose.yaml" ]; then
              ( cd "$SAFELINE_HOME" && docker compose up -d "$svc" ) >/dev/null 2>&1 && started=1
            fi
            ;;
        esac
      fi
      # 成功/失败通知互斥：两种方式都失败时不能再发「已自动拉起」，否则运维会收到互相矛盾的告警
      if [ "$started" -eq 1 ]; then
        notify "[VoiceHub] 容器已自动拉起" "时间：$TS
容器：$c
原状态：${st:-不存在}"
      else
        RC=1
        log "容器 $c 拉起失败"
        notify "[VoiceHub] 容器拉起失败" "时间：$TS
容器：$c
请登录主机检查 compose 配置与容器日志"
      fi
      ;;
  esac
done

# ---- 4) 内存保护：占用超阈值时告警（含占用最高的容器），仅告警不重启 ----
# 只发日志与邮件、不置 RC=1：内存高水位常为持续状态，让监控长期红会掩盖真正的故障信号
mem_pct() { free 2>/dev/null | awk '/^Mem:/ && $2>0 {printf "%d", ($3*100)/$2}'; }
mem_used=$(mem_pct)
if [[ "${mem_used:-}" =~ ^[0-9]+$ ]] && [ "$mem_used" -ge "$MEM_MAX" ]; then
  now=$(date +%s)
  last=$(cat "$MEM_ALERT_AT" 2>/dev/null || echo 0)
  if [ $((now - last)) -ge "$MEM_ALERT_COOLDOWN" ]; then
    echo "$now" > "$MEM_ALERT_AT"
    top=$(docker stats --no-stream --format '{{.Name}}={{.MemUsage}}({{.MemPerc}})' 2>/dev/null | head -5 | paste -sd' ' -)
    log "内存占用 ${mem_used}% ≥ ${MEM_MAX}%：$top"
    notify "[VoiceHub] 内存占用告警" "时间：$TS
内存占用：${mem_used}%（阈值 ${MEM_MAX}%）
占用前五容器：$top
提示：若某容器持续膨胀，检查是否需要重启该容器或加内存上限"
  else
    log "内存占用 ${mem_used}% ≥ ${MEM_MAX}%（距上次告警不足 ${MEM_ALERT_COOLDOWN}s，不重复发送）"
  fi
fi

# ---- 5) 磁盘保护：占用超阈值时清理悬空镜像与构建缓存 ----
# df 输出异常（非纯数字）时跳过，避免 [ -ge ] 语法报错中断脚本
disk_pct() { df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5}'; }
used=$(disk_pct)
if [[ "${used:-}" =~ ^[0-9]+$ ]] && [ "$used" -ge "$DISK_MAX" ]; then
  log "根分区占用 ${used}% ≥ ${DISK_MAX}%，清理悬空镜像与构建缓存"
  prune_rc=0
  docker image prune -f >/dev/null 2>&1 || prune_rc=1
  docker builder prune -f >/dev/null 2>&1 || prune_rc=1
  after=$(disk_pct)
  [[ "${after:-}" =~ ^[0-9]+$ ]] || after=$used
  # 清理是预防性维护：只有清理命令失败、或清理后仍超阈值才算故障（RC=1），
  # 否则每次清理都会让监控误报失败
  if [ "$prune_rc" -ne 0 ] || [ "$after" -ge "$DISK_MAX" ]; then
    RC=1
  fi
  notify "[VoiceHub] 磁盘占用告警" "时间：$TS
根分区占用：${used}% → 清理后 ${after}%（阈值 ${DISK_MAX}%）
已清理悬空镜像与构建缓存，请检查大文件与备份保留策略"
fi

exit "$RC"

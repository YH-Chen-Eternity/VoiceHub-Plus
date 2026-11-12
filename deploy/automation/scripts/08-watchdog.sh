#!/bin/bash
# ---------------------------------------------------------------------------
# VoiceHub 看门狗：健康检查 + 自动恢复（systemd timer 调用，建议每 2 分钟）
# 覆盖三类故障：应用 HTTP 无响应、容器退出、依赖容器异常；另含磁盘占用保护。
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

# ---- 1) 应用存活：连续失败达阈值后重启（带冷却，防重启风暴）----
if curl -fsS -m 5 -o /dev/null "$APP_URL"; then
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
        log "容器恢复命令失败（退出码 $rc）"
        notify "[VoiceHub] 自动恢复命令失败" "时间：$TS
命令退出码：$rc
请检查 docker 权限与 compose 文件"
      fi
      # 最长等待 120s：冷启动含依赖等待与迁移，短于 start_period 易误判失败
      for _ in $(seq 1 24); do
        sleep 5
        curl -fsS -m 5 -o /dev/null "$APP_URL" && break
      done
      if curl -fsS -m 5 -o /dev/null "$APP_URL"; then
        log "重启后恢复响应"
        echo 0 > "$FAIL_FILE"
        notify "[VoiceHub] 应用已自动重启恢复" "时间：$TS
连续失败：$fails 次
动作：docker restart voicehub
结果：健康检查通过"
      else
        log "重启后仍未恢复，需人工介入"
        notify "[VoiceHub] 应用自动重启失败" "时间：$TS
连续失败：$fails 次
动作：docker restart voicehub
结果：仍不可用，请登录主机检查 docker logs voicehub"
      fi
    fi
  fi
fi

# ---- 2) 依赖容器：非 running 时拉起（restart 策略之外的兜底）----
# 容器名 → compose 服务名（去掉 voicehub- 前缀）一一对应：postgres / redis / rewriter
for c in voicehub-postgres voicehub-redis voicehub-rewriter; do
  st=$(state "$c")
  case "$st" in
    running|restarting|created) ;;
    *)
      log "依赖容器 $c 状态异常（${st:-不存在}），尝试拉起"
      # 先单容器 start，避免 compose up 连带拉起 voicehub；start 失败再走 compose
      if ! docker start "$c" >/dev/null 2>&1; then
        if ! ( cd "$VH_HOME" && docker compose up -d "${c#voicehub-}" ) >/dev/null 2>&1; then
          log "依赖容器 $c 拉起失败"
          notify "[VoiceHub] 依赖容器拉起失败" "时间：$TS
容器：$c
请登录主机检查 compose 配置与容器日志"
        fi
      fi
      notify "[VoiceHub] 依赖容器已自动拉起" "时间：$TS
容器：$c
原状态：${st:-不存在}"
      ;;
  esac
done

# ---- 3) 磁盘保护：占用超阈值时清理悬空镜像与构建缓存 ----
used=$(df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
if [ -n "${used:-}" ] && [ "$used" -ge "$DISK_MAX" ]; then
  log "根分区占用 ${used}% ≥ ${DISK_MAX}%，清理悬空镜像与构建缓存"
  docker image prune -f >/dev/null 2>&1
  docker builder prune -f >/dev/null 2>&1
  notify "[VoiceHub] 磁盘占用告警" "时间：$TS
根分区占用：${used}%（阈值 ${DISK_MAX}%）
已清理悬空镜像与构建缓存，请检查大文件与备份保留策略"
fi

exit 0

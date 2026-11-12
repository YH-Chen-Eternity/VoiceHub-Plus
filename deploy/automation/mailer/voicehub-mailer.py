#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# VoiceHub 运维告警投递模板（voicehub-mailer.py）
#
# 职责：把定时运维脚本产生的告警文本，交给 VoiceHub 应用的内部接口，
#       由应用用「站内 SMTP」代发邮件；本程序不自带任何 SMTP 凭据、
#       不连接邮件服务器、不知道任何收件人地址。
#
# 调用契约（与旧 voicehub-mail.py 保持一致，03/04/05 脚本无需改动）：
#   argv[1] = 邮件主题（subject）
#   stdin   = 邮件正文（body，纯文本报告）
#   例：  ./voicehub-mailer.py "[VoiceHub] 每日安全巡检" < report.txt
#        ... | ./voicehub-mailer.py "[VoiceHub] 攻击告警"
#
# 凭据边界：
#   - 站内 SMTP 账号/授权码由管理员在 VoiceHub 后台「SMTP 设置」维护，
#     存于应用数据库，绝不写入本目录、绝不进入仓库。
#   - 自动化侧只需一个内部接口令牌 ATTACK_LOG_TOKEN（与应用 env 同值），
#     放在 /etc/voicehub/automation.env（chmod 600）或以环境变量传入；
#     本模板不含任何真实域名、IP、邮箱或令牌值。
#
# 降级策略：应用不可达（连接失败/超时）时写日志并 exit 0，不阻塞定时脚本；
#           应用可达但明确回报失败（非 2xx，如 SMTP 未配置）时 exit 1，
#           保留 03/04/05 脚本依退出码判断「发送失败」的既有语义。
#
# 仅用 Python3 标准库（urllib）。部署：把本文件复制到主机，chmod 755（或 700），
# 路径填入 VH_MAIL_BIN。说明见 deploy/automation/README.md。
# ---------------------------------------------------------------------------

import json
import os
import sys
import urllib.error
import urllib.request

# 应用内部接口：本机回环地址，可用 VH_OPS_ALERT_URL 覆盖。
# 127.0.0.1 为 RFC 保留的 loopback，不是公网地址；<...> 处均为占位符。
DEFAULT_ENDPOINT = "http://127.0.0.1:3000/api/internal/ops-alert"
DEFAULT_ENV_FILE = "/etc/voicehub/automation.env"
TOKEN_ENV_VAR = "ATTACK_LOG_TOKEN"
REQUEST_TIMEOUT = 8  # 秒；定时脚本不应被一次投递长时间阻塞


def log(message):
    print(message, file=sys.stderr)


def read_token_from_env_file(path):
    """从 env 文件解析 ATTACK_LOG_TOKEN。

    兼容旧脚本用 `. /etc/voicehub/automation.env` 加载配置、但未 export 的情形：
    shell 子进程拿不到未导出的变量，因此这里也直接读一次文件。
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if key.startswith("export "):
                    key = key[len("export "):].strip()
                if key == TOKEN_ENV_VAR:
                    return value.strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def resolve_token(env_file):
    # 优先环境变量传入；缺失时回落读 env 文件（不硬编码任何令牌）
    token = os.environ.get(TOKEN_ENV_VAR, "").strip()
    if not token:
        token = read_token_from_env_file(env_file)
    return token


def main():
    subject = sys.argv[1] if len(sys.argv) > 1 else "VoiceHub 运维告警"
    body = sys.stdin.read()

    env_file = os.environ.get("VH_AUTOMATION_ENV", DEFAULT_ENV_FILE)
    endpoint = os.environ.get("VH_OPS_ALERT_URL", DEFAULT_ENDPOINT)

    token = resolve_token(env_file)
    if not token:
        log("[voicehub-mailer] 降级：未取得 ATTACK_LOG_TOKEN，跳过本次投递（不阻塞定时脚本）")
        return 0

    payload = json.dumps({"subject": subject, "body": body}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-attack-token": token,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            status = getattr(response, "status", None) or response.getcode()
            response.read()
    except urllib.error.HTTPError as exc:
        # 应用可达但明确拒绝/失败（如 503 站内 SMTP 未配置、403 令牌错误）
        log("[voicehub-mailer] 降级：应用返回 HTTP %s，本次告警未投递" % exc.code)
        return 1
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        # 应用不可达（连接失败/超时）：写日志降级，exit 0 不阻塞定时脚本
        log("[voicehub-mailer] 降级：应用不可达（%s），本次告警未投递，不阻塞定时脚本"
            % type(exc).__name__)
        return 0

    if not 200 <= status < 300:
        log("[voicehub-mailer] 降级：应用返回 HTTP %s，本次告警未投递" % status)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

# VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
# Copyright (C) 2026 YH-Chen-Eternity  |  SPDX-License-Identifier: GPL-3.0-only
# 社区版新增文件；完整许可证见仓库根目录 LICENSE。

# 雷池 WAF 部署指南（SafeLine Community Edition）

本文说明如何在本机已有 Nginx 部署的前提下，加入**雷池社区版 WAF** 形成
「CDN → 雷池 → Nginx → 应用」的防护链路。所有步骤均已在本项目参考架构上
实测验证，适用于 2 核 4G 规格的服务器。

---

## 一、目标架构

```
访客 → [Cloudflare（可选，人机验证走 CF）] → 雷池 WAF（监听 80/443，终结 TLS）
     → 本机 Nginx（127.0.0.1:10080，纯 HTTP）→ rewriter(127.0.0.1:3001) → voicehub:3000
```

关键变化：

| 变化点 | 之前 | 之后 |
| --- | --- | --- |
| 80/443 占用 | Nginx | 雷池（tengine） |
| TLS 终结 | Nginx（挂 CF 源证书） | 雷池（挂同一份 CF 源证书） |
| Nginx 监听 | 80 / 443 | `127.0.0.1:10080`（主站）/ `127.0.0.1:10081`（跳转） |
| 雷池控制台 | — | `https://服务器IP:9443`，**建议仅经 SSH 隧道访问，勿放行公网** |

人机验证建议交给 Cloudflare 承担（Turnstile / Under Attack 模式），
雷池侧的「人机验证」站点开关保持关闭即可。

---

## 二、前置条件

- Docker ≥ 20.10.14、Docker Compose ≥ 2.0.0
- Nginx 正常运行且配置可备份（本仓库 `deploy/nginx/` 即参考配置）
- 内存余量 ≥ 2G（`free -h` 的 available），不足时先清理再装

## 三、步骤 1：端口腾挪（Nginx 80/443 → 10080/10081）

1. 备份整套 Nginx 配置：
   ```bash
   tar czf /root/nginx-backup-$(date +%Y%m%d).tar.gz -C / etc/nginx
   ```
2. 修改 `voicehub.conf`（可直接使用本目录模板）：
   - HTTP 跳转块：`listen 80;` → `listen 127.0.0.1:10081;`（删除 IPv6 listen）
   - 主站块：`listen 443 ssl http2;` → `listen 127.0.0.1:10080;`，并注释掉全部 `ssl_*` 指令
3. 生效并确认 80/443 已空出：
   ```bash
   nginx -t && systemctl reload nginx
   ss -tlnp | grep -E ':(80|443)\s'     # 应无输出
   ss -tlnp | grep 10080                 # 应看到 nginx
   ```

> 若雷池版本的安全策略禁止 `127.0.0.1` 作为上游（防 SSRF），让 Nginx 额外监听
> 一个内网地址（如 `192.0.2.10:10080`），雷池上游改用该内网地址。
> **该端口不得对公网放行。**

## 四、步骤 2：安装雷池

```bash
bash -c "$(curl -fsSLk https://waf-ce.chaitin.cn/release/latest/manager.sh)"
```

- 安装目录默认 `/data/safeline/`
- 管理员初始密码如未在输出中给出，执行：
  ```bash
  docker exec safeline-mgt resetadmin
  ```
- 控制台地址 `https://服务器IP:9443`。**不要**在云安全组放行 9443，
  用 SSH 隧道访问：
  ```bash
  ssh -p <SSH端口> -N -L 9443:127.0.0.1:9443 <用户>@<服务器IP>
  # 然后浏览器打开 https://127.0.0.1:9443
  ```
  注意：服务器 sshd 若设置过 `AllowTcpForwarding no`，需改为 `local`
  （只允许本地转发，不放宽远程转发）。

## 五、步骤 3：限制雷池资源（2核4G 必做）

编辑 `/data/safeline/docker-compose.yaml`，给三个关键服务加 `deploy.resources.limits`：

| 服务 | cpus | memory |
| --- | --- | --- |
| safeline-mgt | 1.0 | 950M |
| safeline-detector | 1.0 | 1G |
| safeline-tengine | 0.5 | 384M |

```yaml
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 950M
```

生效：

```bash
cd /data/safeline
docker compose config --quiet && docker compose up -d
docker stats --no-stream | grep safeline    # 确认限制已生效
```

三容器合计上限约 2.3G，为系统与其他进程留出 ≥1G 余量。

## 六、步骤 4：上传证书 + 添加防护站点

控制台 → 证书管理：上传原 Nginx 使用的 CF 源证书（pem + key）。

控制台 → 防护站点 → 添加：

| 项 | 值 |
| --- | --- |
| 域名 | `example.com`、`www.example.com` |
| 监听端口 | `80` + `443_ssl`（选择刚上传的证书） |
| 上游服务器 | `http://127.0.0.1:10080`（或内网地址，见步骤 1 注意） |
| 防护模式 | **先选「观察」**，确认无误报 1-2 天后再切「拦截」 |

保存后雷池 tengine 会自动绑定 80/443，网站入口恢复。

## 七、步骤 5：源 IP 获取方式（配错 = 防护失效）

控制台 → 全局配置 → 源 IP 获取方式：

| 场景 | 必须选择 |
| --- | --- |
| **Cloudflare 在雷池之前**（本项目默认） | 「从 X-Forwarded-For 中获取上一级代理的地址」（xff_first） |
| 用户直连雷池（无 CF） | 「从网络连接中获取」（socket）——**绝不能选 XFF**，否则可被伪造头绕过 |

## 八、步骤 6：Nginx 真实 IP 链路改造（必须）

插入雷池后，Nginx 看到的连接来源变成雷池回源地址。在
`cloudflare-real-ip.conf`（本仓库模板已含该段）追加：

```nginx
# 雷池回源地址（host 网络部署 = 宿主机内网 IP）
set_real_ip_from 192.0.2.10;   # 换成实际内网 IP
```

`real_ip_header CF-Connecting-IP` 保持不变（该头由 CF 覆写、雷池透传，客户端无法伪造）。
改完 `nginx -t && systemctl reload nginx`，并验证访问日志里的 IP 是真实访客 IP。

## 九、验证清单

```bash
# 1) 全链路
curl -sI https://example.com/ | head -3

# 2) 攻击识别（观察模式下只记录不拦截，看雷池攻击日志应有记录）
curl -s -o /dev/null -w '%{http_code}\n' "https://example.com/?id=1' and 1=1-- "

# 3) 真实 IP：雷池攻击日志里的源 IP 应是真实访客 IP，而非 CF 节点或 127.0.0.1

# 4) 资源余量
free -h && docker stats --no-stream | grep safeline

# 5) 暴露面：10080 / 10081 / 9443 公网均不可达，80/443 由雷池监听
```

## 十、免费防护建议开关（人机验证除外）

| 防护项 | 建议 |
| --- | --- |
| 语义分析引擎、漏洞利用规则库（含低危规则） | 开 |
| CC 防护 / Bot 识别 | 开 |
| 扫描器检测（m_scanner） | 开 |
| 恶意 JA4 指纹情报、恶意 IP 准入 | 开（社区版自带） |
| 人机验证（challenge） | 关，由 Cloudflare 承担 |
| 响应检测（m_response） | 关（性能开销大，收益低） |
| HTML/JS 代码加密 | 关（会改写页面 JS，易破坏前端） |

## 十一、回滚

1. 还原 Nginx 备份包（步骤 1 生成），恢复 `listen 80/443` 与 `ssl_*` 配置
2. `cd /data/safeline && docker compose down`，雷池即交还 80/443
3. `docker compose reload nginx`（或 `systemctl reload nginx`）
4. 如需彻底移除：删除 `/data/safeline/` 目录即可，无残留

全程中断通常在 1 分钟以内。

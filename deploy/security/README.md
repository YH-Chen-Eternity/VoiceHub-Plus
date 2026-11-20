# 安全基线

> 只记录通用判定原则与最低版本，不写具体主机、地址、域名、凭据和备份路径。

## 最低版本

| 组件 | 最低版本 | 依据 |
| --- | --- | --- |
| nginx | 1.30.7（或 1.31.9+） | CVE-2026-123633 等一批 HTTP/2 缺陷 |
| openssl | 跟随发行版 `-security` 源 | 回移补丁，不按上游版本号判定 |
| postgres | 15.20 | 15.20 修 52 个 CVE，含 CVSS 8.1 的 CVE-2026-14661 |
| SafeLine | 9.4.5 | NGINX2Root 系列 CVE 修复版 |

## 判定原则

- 按「受影响区间 + 实际配置」判定，不只看版本号。例：CVE-2026-123633 需同时满足启用 HTTP/2、反代上游、连接数接近上限，未开 HTTP/2 的实例不适用。
- 内网组件同样要打补丁。内网不是免修理由，应用侧一旦被突破就是跳板。
- 发行版走回移补丁时，服务端实际已修就不要按上游版本号强升；不源码编译替换系统库。
- 分层要分别确认。CDN / WAF / 源站三层各打各的补丁，改完一层不代表另一层也修了。
- 容器同主版本小升级二进制兼容，换镜像重建即可，无需 `pg_upgrade`；跨主版本才需要迁移。
- 升级前备份并记录基线（关键表行数、表数量），升级后逐项比对。

## 复核

```bash
nginx -v && nginx -t
openssl version && apt-cache policy openssl
postgres --version
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
```

WAF / 入口层升级后用注入与路径穿越探测确认仍返回 403。

## 雷池版本判定

`nginx -v` 只报 `t1k 4.3.0`，版本号不随补丁变化。要看 tengine githash，或 `safeline-mgt` 的 `build-metadata.json`（`version` / `built_at`）。

compose 部署改 `.env` 的 `IMAGE_TAG` 后 `docker compose pull && up -d`；`POSTGRES_IMAGE` 不要动，那是厂商配套版本。

/**
 * 图片代理目标策略。
 *
 * 端口：默认端口、80、443 之外的目标一律拒绝，缩小代理可触达的范围。
 * 常规图床都在 443，收紧后不影响正常取图。
 *
 * 域名白名单：由 IMAGE_PROXY_ALLOWED_HOSTS 提供（逗号分隔，支持 `*.example.com` 写法）。
 * 为空表示不限制——评论配图来自用户填写的地址、站点配置图由管理员自填，
 * 强制白名单会导致图片加载失败，因此默认关闭，由部署方按实际来源决定是否开启。
 * 开启后重定向的每一跳同样受约束（validateUrl 在每次跳转时都会调用）。
 */

const ALLOWED_PORTS = new Set(['', '80', '443'])

export function parseAllowedHosts(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^\*?\.+/, '').replace(/\.+$/, ''))
    .filter((item) => item.length > 0)
}

/**
 * 后缀匹配必须带点边界，否则 `evilhdslb.com` 会命中 `hdslb.com`。
 */
export function isHostnameAllowed(hostname: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return true

  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false

  return allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`))
}

export function isPortAllowed(port: string): boolean {
  return ALLOWED_PORTS.has(String(port ?? ''))
}

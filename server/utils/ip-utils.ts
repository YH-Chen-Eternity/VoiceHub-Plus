/* Modified by YH-Chen-Eternity on 2026-10-23 */

import type { H3Event } from 'h3'
import { getHeaders } from 'h3'
import { isIP } from 'node:net'

const SUPPORTED_CLIENT_IP_HEADERS = new Set([
  'eo-connecting-ip',
  'eo-client-ip',
  'x-edgeone-client-ip',
  'edgeone-client-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'fastly-client-ip',
  'fly-client-ip',
  'x-nf-client-connection-ip',
  'x-vercel-forwarded-for',
  'x-azure-clientip',
  'x-appengine-user-ip',
  'x-cluster-client-ip',
  'x-real-ip',
  'x-client-ip',
  'x-real-client-ip',
  'x-forwarded-client-ip',
  'x-original-forwarded-for',
  'x-forwarded-for',
  'x-forwarded',
  'forwarded-for',
  'forwarded'
])

// 未配置 TRUSTED_CLIENT_IP_HEADERS 时**不信任任何转发头**，只使用 TCP 连接地址。
// 2026-10-23 安全加固：原回退列表直接信任 x-forwarded-for 等 5 个客户端可伪造的头，
// 与 .env.example 中「未配置时只使用 TCP 连接地址」的文档承诺相反；直连源站部署下，
// 攻击者每请求换一个 XFF 即可刷新登录失败计数，使 IP 封禁失效。
// 需要识别代理透传的真实 IP 时（如 Nginx 设置 x-real-ip），必须显式配置
// TRUSTED_CLIENT_IP_HEADERS=x-real-ip，由部署者保证该头只会被受信代理覆写。
const FALLBACK_CLIENT_IP_HEADERS = Object.freeze([] as string[])

function getTrustedClientIPHeaders() {
  const configured = String(process.env.TRUSTED_CLIENT_IP_HEADERS || '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter((header) => SUPPORTED_CLIENT_IP_HEADERS.has(header))

  return configured.length > 0
    ? [...new Set(configured)]
    : FALLBACK_CLIENT_IP_HEADERS
}

/**
 * 获取客户端IP地址
 * @param event H3Event对象
 * @returns 客户端IP地址
 */
export function getClientIP(event: H3Event): string {
  const headers = getHeaders(event)

  // 只有部署者明确声明受信头部时才读取转发头，避免客户端直连源站时伪造 IP。
  const ipHeaders = getTrustedClientIPHeaders()

  for (const header of ipHeaders) {
    const value = headers[header]
    if (value) {
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) {
        for (const candidate of String(item).split(',')) {
          const ip = normalizeIPCandidate(candidate)
          if (ip) return ip
        }
      }
    }
  }

  // 如果没有找到，直接从连接信息获取

  // 从连接信息获取IP（备用方法）
  const remoteAddress = event.node.req.socket?.remoteAddress
  if (remoteAddress) {
    // 移除IPv6映射的IPv4前缀
    const cleanIP = normalizeIPCandidate(remoteAddress)
    if (cleanIP) {
      return cleanIP
    }
  }

  return 'unknown'
}

/**
 * 把 IPv6 归一成 RFC 5952 规范形（小写、压缩零组），并把 IPv4-mapped 地址还原成点分 IPv4。
 *
 * 必要性：`0:0:0:0:0:0:0:1`、`FE80:0:0:0::1` 与 `::1`、`fe80::1` 是同一个地址，但按字面量
 * 做前缀判断会漏判，导致回环/链路本地地址被当成公网地址注入给第三方接口。
 * 幂等：已规范的地址再走一遍结果不变。
 */
function canonicalizeIPv6(ip: string): string {
  // 作用域 ID（fe80::1%eth0）不属于地址本体，且 WHATWG 解析器不接受 `%`；
  // 先剥离再归一化，带 zone 的链路本地地址才能与不带 zone 的写法落到同一判断
  const address = ip.includes('%') ? ip.slice(0, ip.indexOf('%')) : ip
  let normalized: string
  try {
    // WHATWG URL 解析器负责压缩零组并统一小写，比手写展开更不容易出错
    normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  } catch {
    return address
  }

  // v4-mapped 会被序列化成 ::ffff:7f00:1 这种十六进制形式，还原成点分才能复用 IPv4 判断
  const mapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mapped) {
    const high = Number.parseInt(String(mapped[1]), 16)
    const low = Number.parseInt(String(mapped[2]), 16)
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }

  return normalized
}

/**
 * 判断是否为私网或回环地址（此类地址传给第三方接口无意义）
 */
export function isPrivateOrLoopbackAddress(ip: string): boolean {
  if (!ip || ip === 'unknown') return true

  // 先归一化，避免非规范写法（0:0:0:0:0:0:0:1 / FE80:0:0:0::1）绕过下面的判断
  const address = isIP(ip) === 6 ? canonicalizeIPv6(ip) : ip
  if (address === '::1') return true

  if (
    address.startsWith('127.') ||
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    address.startsWith('169.254.')
  ) {
    return true
  }

  const privateB = address.match(/^172\.(\d{1,3})\./)
  if (privateB) {
    const second = Number(privateB[1])
    if (second >= 16 && second <= 31) return true
  }

  // 运营商级 NAT 段 100.64.0.0/10，同样不是可直接对外声明的地址
  const cgnat = address.match(/^100\.(\d{1,3})\./)
  if (cgnat) {
    const second = Number(cgnat[1])
    if (second >= 64 && second <= 127) return true
  }

  // IPv6：按归一化后的首组判断唯一本地地址 fc00::/7 与链路本地地址 fe80::/10
  if (isIP(address) === 6) {
    const firstGroup = address.startsWith('::')
      ? 0
      : Number.parseInt(address.split(':')[0] || '', 16)
    if (Number.isNaN(firstGroup)) return false
    if ((firstGroup & 0xfe00) === 0xfc00) return true
    if ((firstGroup & 0xffc0) === 0xfe80) return true
  }

  return false
}

function normalizeIPCandidate(value: string): string | null {
  let candidate = value.trim().replace(/^"|"$/g, '')
  const forwardedMatch = candidate.match(/^for\s*=\s*(.+)$/i)
  if (forwardedMatch) {
    const forwardedValue = forwardedMatch[1] || ''
    candidate = (forwardedValue.split(';').shift() || '').trim().replace(/^"|"$/g, '')
  }

  if (candidate.startsWith('[')) {
    const closingBracket = candidate.indexOf(']')
    if (closingBracket > 0) candidate = candidate.slice(1, closingBracket)
  } else if (isIP(candidate) === 0 && /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(':'))
  }

  // IPv6 作用域 ID（fe80::1%eth0）不是地址本体：剥离后再校验与透传，
  // 否则会带着 `%zone` 原样发给上游，或让同一地址落到不同限流桶
  candidate = candidate.replace(/%[0-9A-Za-z_.-]+$/, '')

  // 点分 v4-mapped 直接剥前缀；十六进制 v4-mapped 交给 canonicalizeIPv6 还原成 IPv4
  const cleanIP = /^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(candidate)
    ? candidate.slice(7)
    : candidate
  if (!isValidIP(cleanIP)) return null

  // 统一成规范形：同一地址的不同写法不应绕过限流桶，也便于下游做前缀判断
  return isIP(cleanIP) === 6 ? canonicalizeIPv6(cleanIP) : cleanIP
}

/**
 * 验证IP地址格式是否有效
 * @param ip IP地址字符串
 * @returns 是否为有效IP
 */
function isValidIP(ip: string): boolean {
  // Node 原生解析器支持压缩 IPv6，避免大量合法地址被归入 unknown 共享限流桶。
  if (isIP(ip) === 0) {
    return false
  }

  // 排除明显无效的IP
  if (ip === '0.0.0.0' || ip === '::') {
    return false
  }

  return true
}

/**
 * 格式化IP地址用于邮件显示
 * @param ip IP地址
 * @returns 格式化后的IP地址字符串
 */
export function formatIPForEmail(ip: string): string {
  if (!ip || ip === 'unknown') {
    return '未知'
  }

  // 如果是本地IP，显示为本地访问
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.')
  ) {
    return `${ip} (本地网络)`
  }

  return ip
}

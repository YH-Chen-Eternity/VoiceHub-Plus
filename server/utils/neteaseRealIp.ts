/**
 * 网易云接口的 X-Real-IP 出口处理。
 *
 * 背景：网易云按请求来源 IP 判定地区。部署在境外的实例若以自身出口直连，
 * 登录态校验、账号歌单等接口会被判为海外请求而失败。上游 SDK 支持通过
 * `realIP` 参数写入 `X-Real-IP` / `X-Forwarded-For`。
 *
 * 策略：只透传访客真实公网 IP。拿不到访客地址时（内部预取、未配置受信转发头、
 * 私网或回环地址）**不注入任何 realIP**，让请求按上游默认行为走，绝不伪造
 * 或用第三方地址顶替——伪造出口会让登录地点与账号校验落在错误地区，反而
 * 成为异常特征。
 *
 * 因此本模块不持有任何地址池，也不做随机取样。
 */

import { isIP } from 'node:net'
import { isPrivateOrLoopbackAddress } from '~~/server/utils/ip-utils'

/** 是否启用出口 IP 透传（NETEASE_REAL_IP_MODE=off 可整体关停） */
export const isNeteaseRealIpEnabled = (): boolean =>
  String(process.env.NETEASE_REAL_IP_MODE || 'on').trim().toLowerCase() !== 'off'

/** 校验 IPv4 字面量，用于识别 NETEASE_REAL_IP 的排障固定值 */
const isIpv4Literal = (value: string): boolean => {
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 解析本次请求应使用的出口 IP：
 * 1. NETEASE_REAL_IP 指定固定 IPv4 时优先使用（仅排障用，不参与自动回退）；
 * 2. 访客地址为合法公网 IP 时直接用访客 IP；
 * 3. 其余情况返回 undefined —— 不注入 realIP，不做任何回退。
 */
export const resolveNeteaseOutboundIp = (clientIp: string): string | undefined => {
  const fixed = String(process.env.NETEASE_REAL_IP || '').trim()
  if (fixed && isIpv4Literal(fixed)) return fixed
  // 作用域 ID 只在本机链路内有效，透传前剥离（getClientIP 已做一次，这里兜住直接调用）
  const address =
    clientIp && clientIp.includes('%') ? clientIp.slice(0, clientIp.indexOf('%')) : clientIp
  if (address && isIP(address) !== 0 && !isPrivateOrLoopbackAddress(address)) {
    return address
  }
  return undefined
}

/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * 找回密码第二步的通行票据。
 *
 * Turnstile token 是一次性的：两步表单各验一次，第二步就会拿着已核销的 token 去换验，
 * Cloudflare 必然返回 success:false，用户侧只能看到「人机验证失败或已过期」。
 * 所以第一步验证通过后签发一张短时票据，第二步凭票放行。
 *
 * 票据 = base64url(用户名|过期时间戳) + "." + HMAC-SHA256，密钥由 JWT_SECRET 派生。
 */
const TTL_MS = 10 * 60 * 1000
const SEPARATOR = '.'

const normalize = (username: unknown) => String(username ?? '').trim()

function signingKey(): string | null {
  const secret = process.env.JWT_SECRET
  return secret ? `${secret}::password-reset-ticket` : null
}

export function issueResetTicket(username: string, now: number = Date.now()): string {
  const key = signingKey()
  if (!key) throw new Error('JWT_SECRET environment variable is not set')

  const payload = `${normalize(username)}|${now + TTL_MS}`
  const mac = createHmac('sha256', key).update(payload).digest('base64url')
  return `${Buffer.from(payload, 'utf8').toString('base64url')}${SEPARATOR}${mac}`
}

export function verifyResetTicket(
  ticket: unknown,
  username: string,
  now: number = Date.now()
): boolean {
  try {
    const key = signingKey()
    if (!key || typeof ticket !== 'string') return false

    const at = ticket.lastIndexOf(SEPARATOR)
    if (at <= 0) return false

    const payload = Buffer.from(ticket.slice(0, at), 'base64url').toString('utf8')
    const expected = createHmac('sha256', key).update(payload).digest()
    const given = Buffer.from(ticket.slice(at + 1), 'base64url')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false

    const splitAt = payload.lastIndexOf('|')
    if (splitAt < 0) return false
    // 用户名按原样比对：数据库唯一索引区分大小写，折叠会导致他人账号也能用这张票
    if (payload.slice(0, splitAt) !== normalize(username)) return false

    const deadline = Number(payload.slice(splitAt + 1))
    return Number.isFinite(deadline) && deadline > now
  } catch {
    return false
  }
}

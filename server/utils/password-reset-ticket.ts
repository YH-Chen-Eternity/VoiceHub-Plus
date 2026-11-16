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
 * Turnstile token 是一次性的，两步表单如果各验一次，第二步必然拿到「已核销」的旧 token，
 * 表现为「人机验证失败或已过期」。所以第一步验证通过后签发一张短时票据，第二步凭票放行。
 */
const TTL_MS = 10 * 60 * 1000

function signingKey(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }
  // 域分隔，避免与 JWT 签名共用同一把原始密钥
  return `${secret}::password-reset-ticket`
}

const normalize = (username: unknown) => String(username ?? '').trim().toLowerCase()

export function issueResetTicket(username: string, now: number = Date.now()): string {
  const payload = `${normalize(username)}|${now + TTL_MS}`
  const mac = createHmac('sha256', signingKey()).update(payload).digest('base64url')
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${mac}`
}

export function verifyResetTicket(
  ticket: unknown,
  username: string,
  now: number = Date.now()
): boolean {
  if (typeof ticket !== 'string' || !ticket) return false
  const separator = ticket.lastIndexOf('.')
  if (separator <= 0) return false

  const body = ticket.slice(0, separator)
  const mac = ticket.slice(separator + 1)
  let payload: string
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8')
  } catch {
    return false
  }

  const expected = createHmac('sha256', signingKey()).update(payload).digest('base64url')
  const given = Buffer.from(mac, 'utf8')
  const want = Buffer.from(expected, 'utf8')
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false

  const [ticketUser, expiresAt] = payload.split('|')
  if (ticketUser !== normalize(username)) return false

  const deadline = Number(expiresAt)
  return Number.isFinite(deadline) && deadline > now
}

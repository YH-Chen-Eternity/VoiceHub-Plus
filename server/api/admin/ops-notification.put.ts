/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 运维通知：保存后台可配的告警收件人，写入 systemSettings.opsAlertRecipients。
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { createApiError } from '~~/server/utils/apiError'
import { SYSTEM_SETTINGS_DEFAULTS } from '~~/server/utils/system-settings-defaults'

const MAX_RECIPIENTS = 10
const MAX_EMAIL_LENGTH = 120
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const splitRecipients = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setHeader(event, 'Cache-Control', 'no-store')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object') {
    throw createApiError(400, 'OPS_NOTIFICATION_INVALID', '请求体无效')
  }

  const raw = (body as { recipients?: unknown }).recipients
  // 收件人既可是数组，也可是逗号分隔字符串；统一按逗号拆分后逐项校验
  let source: unknown
  if (Array.isArray(raw)) {
    source = raw.join(',')
  } else if (typeof raw === 'string') {
    source = raw
  } else {
    throw createApiError(400, 'OPS_NOTIFICATION_INVALID', '收件人格式无效')
  }

  const recipients: string[] = []
  for (const item of splitRecipients(source)) {
    if (item.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(item)) {
      throw createApiError(400, 'OPS_NOTIFICATION_INVALID', '存在无效的收件人邮箱')
    }
    recipients.push(item)
  }

  if (recipients.length > MAX_RECIPIENTS) {
    throw createApiError(400, 'OPS_NOTIFICATION_INVALID', '收件人最多 10 个')
  }

  // 去重后再落库，避免同一邮箱被重复投递
  const stored = [...new Set(recipients)].join(',')

  const rows = await db.select().from(systemSettings).limit(1)
  let saved
  if (!rows[0]) {
    const inserted = await db
      .insert(systemSettings)
      .values({ ...SYSTEM_SETTINGS_DEFAULTS, opsAlertRecipients: stored })
      .returning()
    saved = inserted[0]
  } else {
    const updated = await db
      .update(systemSettings)
      .set({ opsAlertRecipients: stored })
      .where(eq(systemSettings.id, rows[0].id))
      .returning()
    saved = updated[0]
  }

  const smtpConfigured = Boolean(
    saved?.smtpEnabled && saved?.smtpHost && saved?.smtpFromEmail
  )
  const fromEmail = saved?.smtpFromEmail || saved?.smtpUsername || ''
  const fromName = saved?.smtpFromName || '校园广播站'
  const smtpFrom = fromEmail ? `${fromName} <${fromEmail}>` : ''

  return {
    recipients: splitRecipients(saved?.opsAlertRecipients),
    smtpConfigured,
    smtpFrom
  }
})

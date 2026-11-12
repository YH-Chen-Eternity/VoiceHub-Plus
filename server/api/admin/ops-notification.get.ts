/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 运维通知：读取后台可配的告警收件人与站内 SMTP 配置状态。
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { requireAdmin } from '~~/server/utils/requireAdmin'

const splitRecipients = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setHeader(event, 'Cache-Control', 'no-store')

  const rows = await db.select().from(systemSettings).limit(1)
  const settings = rows[0]

  // 站内 SMTP 是否可用：开关、主机齐备，发件地址 smtpFromEmail 为空时回退发件账号
  // （与 smtpService 的 fromEmail = smtpFromEmail || smtpUsername 口径一致）
  const smtpConfigured = Boolean(
    settings?.smtpEnabled && settings?.smtpHost && (settings?.smtpFromEmail || settings?.smtpUsername)
  )
  const fromEmail = settings?.smtpFromEmail || settings?.smtpUsername || ''
  const fromName = settings?.smtpFromName || '校园广播站'
  const smtpFrom = fromEmail ? `${fromName} <${fromEmail}>` : ''

  return {
    recipients: splitRecipients(settings?.opsAlertRecipients),
    smtpConfigured,
    smtpFrom
  }
})

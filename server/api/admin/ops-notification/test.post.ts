/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 运维通知：发送测试邮件，验证「站内 SMTP + 当前收件人配置」是否可用。
 * 仅超级管理员可调用；不复用 /api/internal/ops-alert（避免前台接触内部令牌）。
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { requireSuperAdmin } from '~~/server/utils/requireAdmin'
import { createApiError } from '~~/server/utils/apiError'
import { SmtpService } from '~~/server/services/smtpService'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const splitRecipients = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export default defineEventHandler(async (event) => {
  requireSuperAdmin(event)
  setHeader(event, 'Cache-Control', 'no-store')

  const rows = await db.select().from(systemSettings).limit(1)
  const settings = rows[0]
  const smtpConfigured = Boolean(
    settings?.smtpEnabled && settings?.smtpHost && settings?.smtpFromEmail
  )
  if (!smtpConfigured) {
    throw createApiError(503, 'OPS_ALERT_SMTP_NOT_CONFIGURED', '站内 SMTP 未配置，无法发送测试邮件')
  }

  // 允许前端传「尚未保存的收件人」用于试发；未传则用已保存的配置（含 env 回落）
  const body = await readBody(event).catch(() => null)
  const requested = (body as { recipients?: unknown } | null)?.recipients
  let recipients: string[]
  if (Array.isArray(requested)) {
    recipients = requested.map((item) => String(item || '').trim()).filter(Boolean)
  } else if (typeof requested === 'string') {
    recipients = splitRecipients(requested)
  } else {
    recipients = splitRecipients(settings?.opsAlertRecipients)
    if (recipients.length === 0) recipients = splitRecipients(process.env.VH_MAIL_TO)
  }
  recipients = [...new Set(recipients)].slice(0, 10)
  for (const item of recipients) {
    if (item.length > 120 || !EMAIL_RE.test(item)) {
      throw createApiError(400, 'OPS_NOTIFICATION_INVALID', '存在无效的收件人邮箱')
    }
  }
  if (recipients.length === 0) {
    throw createApiError(400, 'OPS_NOTIFICATION_INVALID', '请先配置至少一个收件人')
  }

  const smtpService = SmtpService.getInstance()
  const initialized = await smtpService.initializeSmtpConfig(true)
  if (!initialized) {
    throw createApiError(503, 'OPS_ALERT_SMTP_NOT_CONFIGURED', '站内 SMTP 初始化失败')
  }

  const subject = 'VoiceHub 运维通知测试邮件'
  const text = '这是一封来自 VoiceHub 管理后台的测试邮件。收到即表示站内 SMTP 与收件人配置可用。'
  const html = smtpService.generateEmailTemplate(subject, text)

  let sent = 0
  let failed = 0
  for (const recipient of recipients) {
    try {
      await smtpService.sendMail(recipient, subject, html, text)
      sent++
    } catch {
      failed++
    }
  }
  // 只输出聚合数量，绝不打印收件人地址或 SMTP 凭据
  console.log(`[ops-notification-test] 发送完成 sent=${sent} failed=${failed}`)
  if (sent === 0) {
    throw createApiError(502, 'OPS_ALERT_SMTP_NOT_CONFIGURED', '测试邮件全部发送失败，请检查 SMTP 配置')
  }
  return { sent, failed }
})

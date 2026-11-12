/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 内部端点：供 voicehub-mailer 把运维告警交给站内 SMTP 代发。
 * 鉴权沿用 ATTACK_LOG_TOKEN + x-attack-token（同 attack-log.post.ts）。
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { timingSafeEqual } from 'node:crypto'
import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { SmtpService } from '~~/server/services/smtpService'

const MAX_SUBJECT = 300
const MAX_BODY = 20000

function safeEqualString(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

const splitRecipients = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export default defineEventHandler(async (event) => {
  const expected = String(process.env.ATTACK_LOG_TOKEN || '')
  if (!expected) {
    throw createApiError(503, 'ATTACK_LOG_DISABLED', '攻击日志令牌未配置')
  }
  const provided = String(getHeader(event, 'x-attack-token') || '')
  if (!safeEqualString(provided, expected)) {
    throw createApiError(403, 'OPS_ALERT_FORBIDDEN', '无权写入')
  }
  setHeader(event, 'Cache-Control', 'no-store')

  const payload = await readBody(event).catch(() => null)
  if (!payload || typeof payload !== 'object') {
    throw createApiError(400, 'OPS_ALERT_INVALID', '请求体无效')
  }
  // 标题去掉换行避免邮件头注入；正文是定时脚本产生的纯文本报告
  const subject = String((payload as { subject?: unknown }).subject ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_SUBJECT)
  const text = String((payload as { body?: unknown }).body ?? '').slice(0, MAX_BODY)
  if (!subject || !text) {
    throw createApiError(400, 'OPS_ALERT_INVALID', 'subject 或 body 不能为空')
  }

  const rows = await db.select().from(systemSettings).limit(1)
  const settings = rows[0]

  // 应用侧 SMTP 未配置：明确回 503，让调用方知道邮件通道不具备
  // 发件地址与 smtpService 口径一致：smtpFromEmail 为空时回退发件账号
  const smtpConfigured = Boolean(
    settings?.smtpEnabled && settings?.smtpHost && (settings?.smtpFromEmail || settings?.smtpUsername)
  )
  if (!smtpConfigured) {
    throw createApiError(503, 'OPS_ALERT_SMTP_NOT_CONFIGURED', '站内 SMTP 未配置，无法发送运维告警邮件')
  }

  // 后台配置优先；为空（NULL 或空串）才回落到 env 里的 VH_MAIL_TO
  const configured = splitRecipients(settings?.opsAlertRecipients)
  const recipients = configured.length > 0 ? configured : splitRecipients(process.env.VH_MAIL_TO)
  if (recipients.length === 0) {
    // 只记数量，不打印收件人列表；无收件人视为空投递，不阻塞定时脚本
    console.warn('[ops-alert] 未配置运维告警收件人，跳过发送')
    return { sent: 0, failed: 0 }
  }

  const smtpService = SmtpService.getInstance()
  // 强制刷新：单例可能持有过期或已被清空的 transporter
  const initialized = await smtpService.initializeSmtpConfig(true)
  if (!initialized) {
    throw createApiError(503, 'OPS_ALERT_SMTP_NOT_CONFIGURED', '站内 SMTP 初始化失败')
  }

  // generateEmailTemplate 会转义正文，适合纯文本报告；text 作为纯文本备选
  const html = smtpService.generateEmailTemplate(subject, text)

  let sent = 0
  let failed = 0
  for (const recipient of recipients) {
    try {
      await smtpService.sendMail(recipient, subject, html, text)
      sent++
    } catch (error: any) {
      failed++
      // 只记序号与错误摘要，绝不打印收件人地址或 SMTP 凭据
      console.warn(
        `[ops-alert] 第 ${sent + failed} 位收件人发送失败：${error instanceof Error ? error.message : '未知错误'}`
      )
    }
  }

  // 只输出聚合数量，不输出完整收件人列表
  console.log(`[ops-alert] 发送完成 sent=${sent} failed=${failed}`)
  return { sent, failed }
})

import { SmtpService } from '~~/server/services/smtpService'
import { getSystemSettingsCached } from '~~/server/utils/system-settings-helper'
import { hasAdminPermission } from '~/utils/admin-permissions'
import { resolveSmtpTestConfig } from '~~/server/utils/smtp-test-config'
import { ADMIN_AUDIT_RESULT, recordAdminAudit } from '~~/server/utils/admin-audit'

export default defineEventHandler(async (event) => {
  let smtpService: SmtpService | undefined
  try {
    const body = await readBody(event) || {}
    const stored = await getSystemSettingsCached() || {}
    const config = resolveSmtpTestConfig(body, stored, hasAdminPermission(event.context.user, 'smtp:write'))
    if (!config.smtpEnabled) return { success: false, message: 'SMTP服务未启用' }
    if (!config.smtpHost || !config.smtpUsername || !config.smtpPassword) {
      return { success: false, message: '请填写完整的SMTP配置信息' }
    }

    if (!body.smtpHost || !body.smtpUsername || !body.smtpPassword) {
      return {
        success: false,
        message: '请填写完整的SMTP配置信息'
      }
    }

    // 创建临时的SMTP服务实例进行测试
    const smtpService = SmtpService.getInstance()

    // 临时设置配置进行测试
    const originalConfig = smtpService.smtpConfig
    const originalTransporter = smtpService.transporter

    try {
      // 掩码密码回退：以数据库持久化值为准，内存单例不可靠（冷启动竞态/陈旧配置）
      let testPassword = body.smtpPassword
      if (testPassword === SMTP_PASSWORD_MASK) {
        const dbSettings = await getSystemSettingsCached()
        testPassword = dbSettings?.smtpPassword || ''
      }

      if (!testPassword) {
        return {
          success: false,
          message: '未找到有效的SMTP密码，请重新填写授权码并保存配置'
        }
      }

      // 设置测试配置
      smtpService.smtpConfig = {
        host: body.smtpHost,
        port: body.smtpPort || 587,
        secure: body.smtpSecure || false,
        auth: {
          user: body.smtpUsername,
          pass: testPassword
        },
        fromEmail: body.smtpFromEmail || body.smtpUsername,
        fromName: body.smtpFromName || '校园广播站'
      }

      // 创建测试transporter
      const nodemailer = await import('nodemailer')
      smtpService.transporter = nodemailer.default.createTransport({
        host: smtpService.smtpConfig.host,
        port: smtpService.smtpConfig.port,
        secure: smtpService.smtpConfig.secure,
        auth: smtpService.smtpConfig.auth
      })

      // 测试连接
      const result = await smtpService.testConnection()

      return result
    } finally {
      // 恢复原始配置
      smtpService.smtpConfig = originalConfig
      smtpService.transporter = originalTransporter
    }
  } catch (error: any) {
    console.error('测试SMTP连接失败:', error)
    return {
      success: false,
      message: '测试连接失败',
      detail: error instanceof Error ? error.message : String(error)
    }
  } finally {
    smtpService?.transporter?.close()
  }
})

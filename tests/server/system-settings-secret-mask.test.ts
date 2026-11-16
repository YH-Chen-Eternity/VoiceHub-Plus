import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  SECRET_FIELD_MASK,
  SMTP_PASSWORD_MASK,
  maskSystemSettingsSecrets,
  omitMaskedSystemSettingsSecrets
} from '../../server/api/admin/system-settings/secretMask.ts'

// 系统设置凭据脱敏边界：响应与备份产物都不回传密钥
const read = (relative: string) => readFileSync(join(import.meta.dirname, relative), 'utf8')

const AUTO_BACKUP = read('../../server/services/autoBackupService.ts')
const EXPORT_BACKUP = read('../../server/api/admin/backup/export.post.ts')
const RESTORE = read('../../server/api/admin/backup/restore.post.ts')
const RESTORE_CHUNK = read('../../server/api/admin/backup/restore-chunk.post.ts')

test('系统设置响应不回传备份目标凭据', () => {
  const masked = maskSystemSettingsSecrets({
    siteTitle: 'VoiceHub',
    smtpPassword: 'smtp-secret',
    astrbotToken: 'bot-secret',
    turnstileSecretKey: 'turnstile-secret',
    autoBackupConfig: JSON.stringify({ methods: { s3: { secretKey: 'sk-should-not-leave-server' } } })
  }) as unknown as Record<string, unknown>
  assert.equal('autoBackupConfig' in masked, false, 'autoBackupConfig 含 S3/WebDAV/Telegram 凭据，不得出现在响应里')
  assert.equal(masked.siteTitle, 'VoiceHub')
  assert.equal(masked.smtpPassword, SMTP_PASSWORD_MASK)
  assert.equal(masked.astrbotToken, SECRET_FIELD_MASK)
  assert.equal(masked.turnstileSecretKey, SECRET_FIELD_MASK)
})

test('空凭据字段保持原值', () => {
  const masked = maskSystemSettingsSecrets({
    smtpPassword: '',
    astrbotToken: null,
    autoBackupConfig: null
  }) as unknown as Record<string, unknown>
  assert.equal(masked.smtpPassword, '')
  assert.equal(masked.astrbotToken, null)
})

test('自动备份与手动导出都先脱敏，并整列移除备份渠道配置', () => {
  for (const [name, source] of [['自动备份', AUTO_BACKUP], ['手动导出', EXPORT_BACKUP]] as const) {
    assert.match(source, /maskSystemSettingsSecrets/, `${name} 应先脱敏系统设置`)
    assert.match(source, /delete rest\.autoBackupConfig/, `${name} 应移除含第三方口令的备份渠道配置`)
  }
})

test('恢复白名单保留自动备份配置字段', () => {
  for (const [name, source] of [['restore', RESTORE], ['restore-chunk', RESTORE_CHUNK]] as const) {
    assert.match(source, /'autoBackupConfig'/, `${name} 必须能恢复该字段`)
  }
})

test('掩码值不会被写成真实密钥', () => {
  const cleaned = omitMaskedSystemSettingsSecrets({
    smtpPassword: SMTP_PASSWORD_MASK,
    astrbotToken: SECRET_FIELD_MASK,
    siteTitle: 'VoiceHub'
  }) as unknown as Record<string, unknown>
  assert.equal('smtpPassword' in cleaned, false)
  assert.equal('astrbotToken' in cleaned, false)
  assert.equal(cleaned.siteTitle, 'VoiceHub')
})

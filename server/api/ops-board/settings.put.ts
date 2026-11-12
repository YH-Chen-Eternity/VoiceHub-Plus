/**
 * 更新看板設定。requireSuperAdmin + 手動審計
 * （/api/ops-board 不在 zz-admin-guard.ts 管轄範圍，寫操作不會被自動記錄）。
 */
import { defineEventHandler, readBody } from 'h3'
import { requireSuperAdmin } from '~~/server/utils/requireAdmin'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'
import { setOpsBoardNoStore, writeOpsBoardSettings } from './_shared'

export default defineEventHandler(async (event) => {
  requireSuperAdmin(event)
  setOpsBoardNoStore(event)

  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const errors: string[] = []
  let cosQuotaBytes: number | null | undefined
  let logRetentionDays: number | undefined

  if ('cosQuotaBytes' in (body || {})) {
    const raw = body.cosQuotaBytes
    if (raw === null || raw === '' || raw === undefined) {
      cosQuotaBytes = null
    } else {
      const value = Number(raw)
      if (!Number.isSafeInteger(value) || value < 0) {
        errors.push('cosQuotaBytes 必须为非负整数或 null')
      } else {
        cosQuotaBytes = value
      }
    }
  }
  if ('logRetentionDays' in (body || {})) {
    const value = Number(body.logRetentionDays)
    if (!Number.isSafeInteger(value) || value < 1 || value > 3650) {
      errors.push('logRetentionDays 必须在 1~3650 之间')
    } else {
      logRetentionDays = value
    }
  }
  if (errors.length) {
    throw createApiError(400, 'OPS_BOARD_SETTINGS_INVALID', errors.join('；'))
  }
  if (cosQuotaBytes === undefined && logRetentionDays === undefined) {
    throw createApiError(400, 'OPS_BOARD_SETTINGS_INVALID', '没有可更新的字段')
  }

  const result = await writeOpsBoardSettings({ cosQuotaBytes, logRetentionDays })
  if (!result.ok) {
    throw createApiError(503, 'OPS_BOARD_SETTINGS_UNAVAILABLE', '设置表暂不可用，请确认迁移已执行')
  }

  const changes = { cosQuotaBytes, logRetentionDays }
  await writeAdminAudit(event, {
    action: 'OPS_BOARD_SETTINGS_UPDATE',
    target: 'OpsBoardSettings',
    detail: JSON.stringify(changes)
  })
  console.info(
    '[ops-board][audit]',
    JSON.stringify({ action: 'OPS_BOARD_SETTINGS_UPDATE', at: new Date().toISOString(), changes })
  )

  return { ok: true, settings: result.settings }
})

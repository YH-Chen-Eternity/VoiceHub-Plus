/**
 * 讀取看板設定（OpsBoardSettings）。表尚未遷移時回傳預設值且 available:false。
 */
import { defineEventHandler } from 'h3'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { readOpsBoardSettings, setOpsBoardNoStore } from './_shared'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setOpsBoardNoStore(event)

  const settings = await readOpsBoardSettings()
  return {
    cosQuotaBytes: settings.cosQuotaBytes,
    logRetentionDays: settings.logRetentionDays,
    updatedAt: settings.updatedAt,
    available: settings.available
  }
})

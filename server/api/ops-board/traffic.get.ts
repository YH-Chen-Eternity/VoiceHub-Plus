/**
 * 流量與配額。
 *   metered  — 應用側 media 出站計量（Redis，trafficMeter.ts；埋點由主 agent 收尾掛載）
 *   official — 騰訊雲監控 GetMonitorData（唯讀子帳號密鑰，未配置降級）
 *   quota    — total 讀 OpsBoardSettings.cosQuotaBytes，used 取 metered.month（月度口徑）
 */
import { defineEventHandler } from 'h3'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { getTrafficStats } from '~~/server/utils/trafficMeter'
import { getCosOfficialTraffic } from '~~/server/utils/tencentMonitor'
import { readOpsBoardSettings, setOpsBoardNoStore } from './_shared'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setOpsBoardNoStore(event)

  const [metered, official, settings] = await Promise.all([
    getTrafficStats(),
    getCosOfficialTraffic(),
    readOpsBoardSettings()
  ])

  const total = settings.cosQuotaBytes
  const used = metered.month

  return {
    metered: {
      today: metered.today,
      month: metered.month,
      rank: metered.rank,
      filesToday: metered.filesToday,
      available: metered.available
    },
    official: {
      available: official.available,
      today: official.today,
      month: official.month,
      unit: official.unit
    },
    quota: {
      total,
      used,
      remaining: total === null ? null : Math.max(0, total - used),
      period: 'month',
      available: total !== null && settings.available
    }
  }
})

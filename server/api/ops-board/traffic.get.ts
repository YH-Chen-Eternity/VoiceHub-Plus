/**
 * 流量與配額。
 *   metered   — 應用側 media 出站計量（Redis，trafficMeter.ts；埋點由主 agent 收尾掛載）
 *   official  — 騰訊雲監控 GetMonitorData（唯讀子帳號密鑰，未配置降級）
 *   lighthouse— 輕量伺服器流量包真實餘量（DescribeInstancesTrafficPackages，5 分鐘快取）
 *   quota     — 優先 lighthouse 真實口徑；未配置時回退
 *               total=OpsBoardSettings.cosQuotaBytes / used=metered.month（月度估算）
 */
import { defineEventHandler } from 'h3'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { getTrafficStats } from '~~/server/utils/trafficMeter'
import { getCosOfficialTraffic } from '~~/server/utils/tencentMonitor'
import { getLighthouseTrafficPackage } from '~~/server/utils/lighthouseTraffic'
import { readOpsBoardSettings, setOpsBoardNoStore } from './_shared'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setOpsBoardNoStore(event)

  const [metered, official, settings, lighthouse] = await Promise.all([
    getTrafficStats(),
    getCosOfficialTraffic(),
    readOpsBoardSettings(),
    getLighthouseTrafficPackage()
  ])

  const fallbackTotal = settings.cosQuotaBytes
  const fallbackUsed = metered.month

  const useLighthouse = lighthouse.available && lighthouse.total != null
  const total = useLighthouse ? lighthouse.total : fallbackTotal
  const used = useLighthouse ? lighthouse.used : fallbackUsed

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
    lighthouse: {
      available: lighthouse.available,
      total: lighthouse.total,
      used: lighthouse.used,
      remaining: lighthouse.remaining,
      periodStart: lighthouse.periodStart,
      periodEnd: lighthouse.periodEnd,
      instanceId: lighthouse.instanceId
    },
    quota: {
      total,
      used,
      // used 為 null（已用未知）時 remaining 也置 null，避免 0-偽裝成「未用」
      remaining: total === null || used == null ? null : Math.max(0, total - used),
      period: useLighthouse ? 'billing' : 'month',
      source: useLighthouse ? 'lighthouse' : 'estimated',
      available: total !== null && settings.available
    }
  }
})

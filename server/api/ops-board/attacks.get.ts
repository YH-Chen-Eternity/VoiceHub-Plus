/**
 * 攻擊分析。
 *   byType / ipTop：優先雷池 mgt 攻擊日誌（queryAttackAgg），
 *                   雷池不可用時降級為應用側 AttackLog 聚合並標 estimated:true。
 *   regions：雷池有地域欄位時用雷池；否則用 ip-geo 對應用側 Top IP 粗聚合
 *            （distinctIp 口徑，帶快取 + 2.5s 逾時，失敗給空陣列）。
 *   bans：唯讀呼叫 fetchRewriterBans()（不修改 Agent D 的檔案）。
 */
import { defineEventHandler } from 'h3'
import { and, desc, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { attackLogs } from '~/drizzle/schema'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import {
  queryAttackAgg,
  type NameValue,
  type IpValue
} from '~~/server/utils/safelineTables'
import { fetchRewriterBans } from '~~/server/utils/rewriterBans'
import { resolveIpLocations } from '~~/server/utils/ip-geo'
import {
  errMessage,
  parseOpsRange,
  safeQuery,
  setOpsBoardNoStore,
  timeWhere
} from './_shared'

async function buildRegions(ips: string[]): Promise<{ regions: NameValue[]; available: boolean }> {
  if (!ips.length) return { regions: [], available: false }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const map = await Promise.race([
      resolveIpLocations(ips),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 2500)
      })
    ])
    if (!map) return { regions: [], available: false }
    const counts = new Map<string, number>()
    for (const [, location] of map) {
      const label = location?.label || '未知'
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const regions = [...counts.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20)
    return { regions, available: true }
  } catch (error) {
    console.warn('[ops-board] regions 聚合失敗，降級:', errMessage(error))
    return { regions: [], available: false }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setOpsBoardNoStore(event)

  const info = parseOpsRange(event)
  const where = and(timeWhere(attackLogs.createdAt, info))
  const eventsExpr = sql<number>`coalesce(sum(greatest(coalesce(${attackLogs.count}, 0), 1)), 0)::int`

  const appByType = await safeQuery<NameValue[]>(
    'attacks:byType',
    async () => {
      const rows = await db
        .select({ name: attackLogs.kind, value: eventsExpr })
        .from(attackLogs)
        .where(where)
        .groupBy(attackLogs.kind)
        .orderBy(desc(eventsExpr))
        .limit(20)
      return rows.map((row) => ({ name: row.name || '未知', value: Number(row.value) || 0 }))
    },
    []
  )

  const appIpTop = await safeQuery<IpValue[]>(
    'attacks:ipTop',
    async () => {
      const rows = await db
        .select({ ip: attackLogs.ip, value: eventsExpr })
        .from(attackLogs)
        .where(where)
        .groupBy(attackLogs.ip)
        .orderBy(desc(eventsExpr))
        .limit(20)
      return rows.map((row) => ({ ip: row.ip, value: Number(row.value) || 0 }))
    },
    []
  )

  const safeline = await queryAttackAgg(info.range, info.startTime)
  const byType = safeline.available && safeline.byType.length ? safeline.byType : appByType
  const ipTop = safeline.available && safeline.ipTop.length ? safeline.ipTop : appIpTop

  const bans = await safeQuery('attacks:bans', () => fetchRewriterBans(), null)

  const regionSource =
    safeline.available && safeline.regions.length
      ? { regions: safeline.regions, available: true }
      : await buildRegions(appIpTop.map((row) => row.ip).filter(Boolean).slice(0, 50))

  return {
    available: safeline.available,
    estimated: !safeline.available,
    source: safeline.available
      ? `雷池 mgt ${safeline.table}`
      : '应用侧 AttackLog（雷池库不可用）',
    byType,
    ipTop,
    regions: regionSource.regions,
    regionsAvailable: regionSource.available,
    regionsUnit: safeline.available ? 'attackEvents' : 'distinctIp',
    bans: {
      available: bans !== null,
      permanent: bans?.permanent ?? [],
      locks: bans?.locks ?? [],
      total: (bans?.permanent?.length ?? 0) + (bans?.locks?.length ?? 0)
    }
  }
})

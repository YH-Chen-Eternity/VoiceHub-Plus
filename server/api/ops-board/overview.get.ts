/**
 * 總覽指標。
 *
 * 資料源與降級：
 *   - blocked / attackIp / series[].blocked：應用側 AttackLog（drizzle，穩定可用）。
 *   - requests / pv / uv / rate4xx / rate5xx / qps：優先讀雷池 mgt 全量流量
 *     （queryHttpTrafficAgg）；雷池不可用時應用側沒有 HTTP 訪問日誌表，
 *     改以 AttackLog + LoginAttempt 合理估算，並回傳 estimated:true 與
 *     estimatedFields，供前端顯示口徑。
 *   - series[].requests 一律為估算（以攔截事件分佈按比例分攤或等同 blocked）。
 */
import { defineEventHandler } from 'h3'
import { and, count, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { attackLogs, loginAttempts } from '~/drizzle/schema'
import { requireOpsBoardViewer } from '~~/server/utils/opsBoardViewer'
import { queryHttpTrafficAgg } from '~~/server/utils/safelineTables'
import {
  parseOpsRange,
  rangeDurationSeconds,
  safeQuery,
  seriesBuckets,
  setOpsBoardNoStore,
  timeWhere
} from './_shared'

export default defineEventHandler(async (event) => {
  await requireOpsBoardViewer(event)
  setOpsBoardNoStore(event)

  const info = parseOpsRange(event)
  const where = and(timeWhere(attackLogs.createdAt, info))
  const eventsExpr = sql<number>`coalesce(sum(greatest(coalesce(${attackLogs.count}, 0), 1)), 0)::int`
  const bucketSec = Math.max(1, Math.floor(info.bucketMs / 1000))
  const bucketExpr = sql<number>`floor(extract(epoch from ${attackLogs.createdAt}) / ${bucketSec})::bigint * ${bucketSec}`

  const attackAgg = await safeQuery(
    'overview:attack',
    async () => {
      const [row] = await db
        .select({
          rows: count(),
          hits: eventsExpr,
          ips: sql<number>`count(distinct ${attackLogs.ip})::int`
        })
        .from(attackLogs)
        .where(where)
      return {
        rows: Number(row?.rows ?? 0),
        hits: Number(row?.hits ?? 0),
        ips: Number(row?.ips ?? 0)
      }
    },
    { rows: 0, hits: 0, ips: 0 }
  )

  const loginAgg = await safeQuery(
    'overview:login',
    async () => {
      const [row] = await db
        .select({
          rows: count(),
          ips: sql<number>`count(distinct ${loginAttempts.ip})::int`
        })
        .from(loginAttempts)
        .where(timeWhere(loginAttempts.createdAt, info))
      return { rows: Number(row?.rows ?? 0), ips: Number(row?.ips ?? 0) }
    },
    { rows: 0, ips: 0 }
  )

  const rawSeries = await safeQuery<{ ts: number; events: number }[]>(
    'overview:series',
    () =>
      db
        .select({ ts: bucketExpr, events: eventsExpr })
        .from(attackLogs)
        .where(where)
        .groupBy(bucketExpr)
        .orderBy(bucketExpr),
    []
  )

  const http = await queryHttpTrafficAgg(info.range, info.startTime)
  const realTraffic = http.available

  const blocked = attackAgg.hits > 0 ? attackAgg.hits : attackAgg.rows
  const attackIp = attackAgg.ips
  // 估算口徑：可觀測事件數（攔截事件 + 登入嘗試），非真實 HTTP 請求總量。
  const requests = realTraffic ? http.requests : blocked + loginAgg.rows
  const pv = realTraffic ? http.pv : requests
  const uv = realTraffic ? http.uv : Math.max(attackIp, loginAgg.ips)
  const rate4xx = realTraffic ? http.rate4xx : 0
  const rate5xx = realTraffic ? http.rate5xx : 0
  const qps = Math.round((requests / rangeDurationSeconds(info)) * 100) / 100

  const buckets = seriesBuckets(info)
  const step = buckets.length > 1 ? buckets[1] - buckets[0] : info.bucketMs
  const blockedByTs = new Map<number, number>()
  for (const row of rawSeries) {
    const ts = Number(row.ts) * 1000
    // all 範圍的骨架只展示最近 30 天，略過更早的資料避免全擠進第一桶。
    if (buckets.length && ts < buckets[0]) continue
    const aligned = buckets.length
      ? buckets[0] +
        Math.max(0, Math.min(buckets.length - 1, Math.round((ts - buckets[0]) / step))) * step
      : ts
    blockedByTs.set(aligned, (blockedByTs.get(aligned) ?? 0) + (Number(row.events) || 0))
  }
  const totalBlockedInSeries = [...blockedByTs.values()].reduce((sum, value) => sum + value, 0)
  const series = buckets.map((ts) => {
    const bucketBlocked = blockedByTs.get(ts) ?? 0
    const bucketRequests =
      realTraffic && totalBlockedInSeries > 0
        ? Math.round((requests * bucketBlocked) / totalBlockedInSeries)
        : bucketBlocked
    return { ts, requests: bucketRequests, blocked: bucketBlocked }
  })

  const estimated = !realTraffic
  return {
    requests,
    pv,
    uv,
    uniqueIp: uv,
    blocked,
    attackIp,
    rate4xx,
    rate5xx,
    qps,
    rateUnit: 'percent',
    series,
    estimated,
    estimatedFields: estimated
      ? ['requests', 'pv', 'uv', 'uniqueIp', 'rate4xx', 'rate5xx', 'qps', 'series.requests']
      : ['series.requests'],
    sources: {
      blocked: 'AttackLog（应用侧攻击事件）',
      attackIp: 'AttackLog distinct ip',
      http: realTraffic
        ? `雷池 mgt ${http.table}`
        : '无 HTTP 访问日志表，按 AttackLog + LoginAttempt 估算'
    },
    range: info.range,
    seriesNote:
      'series[].blocked 为应用侧真实攻击事件分桶；series[].requests 为估算值'
  }
})

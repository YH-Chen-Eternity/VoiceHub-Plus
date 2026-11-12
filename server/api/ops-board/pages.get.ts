/**
 * 頁面與 UA Top。應用側沒有 HTTP 訪問日誌表，
 * 因此以 AttackLog 的 path / userAgent 聚合（攻擊事件口徑，非全站 PV）。
 */
import { defineEventHandler } from 'h3'
import { and, desc, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { attackLogs } from '~/drizzle/schema'
import { requireOpsBoardViewer } from '~~/server/utils/opsBoardViewer'
import { parseOpsRange, safeQuery, setOpsBoardNoStore, timeWhere } from './_shared'

interface TopRow {
  name: string | null
  value: number
}

export default defineEventHandler(async (event) => {
  await requireOpsBoardViewer(event)
  setOpsBoardNoStore(event)

  const info = parseOpsRange(event)
  const where = and(timeWhere(attackLogs.createdAt, info))
  const eventsExpr = sql<number>`coalesce(sum(greatest(coalesce(${attackLogs.count}, 0), 1)), 0)::int`

  const pagesTop = await safeQuery<TopRow[]>(
    'pages:top',
    () =>
      db
        .select({ name: attackLogs.path, value: eventsExpr })
        .from(attackLogs)
        .where(and(where, sql`${attackLogs.path} is not null and ${attackLogs.path} <> ''`))
        .groupBy(attackLogs.path)
        .orderBy(desc(eventsExpr))
        .limit(15),
    []
  )

  const uaTop = await safeQuery<TopRow[]>(
    'pages:ua',
    () =>
      db
        .select({ name: attackLogs.userAgent, value: eventsExpr })
        .from(attackLogs)
        .where(
          and(where, sql`${attackLogs.userAgent} is not null and ${attackLogs.userAgent} <> ''`)
        )
        .groupBy(attackLogs.userAgent)
        .orderBy(desc(eventsExpr))
        .limit(15),
    []
  )

  return {
    available: true,
    estimated: true,
    source: 'AttackLog（path / userAgent，攻击事件口径，非全站 PV）',
    pagesTop: pagesTop.map((row) => ({ name: row.name || '未知', value: Number(row.value) || 0 })),
    uaTop: uaTop.map((row) => ({ name: row.name || '未知', value: Number(row.value) || 0 }))
  }
})

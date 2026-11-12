/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 雷池（SafeLine）mgt 庫攻擊日誌／流量統計的只讀聚合。
 *
 * 表結構已按雷池 9.x 免費個人版實測校正（2026-11，生產庫 safeline-ce）：
 *   - mgt_detect_log_basic        攻擊／異常偵測記錄（只存偵測事件，非全量流量）
 *       timestamp bigint（秒級 epoch，有索引）、src_ip、attack_type bigint、
 *       risk_level、action、country/province/city；沒有 status_code 列。
 *   - mgt_statistics_agg          聚合表（type/key/count/time，time 為小時級 epoch）
 *       type='status_code'（key=狀態碼）→ 全量請求數與 4xx/5xx 佔比；
 *       type='pv'（key=content-type）→ 頁面瀏覽量。
 *   - statistics_ips              按 IP 的 30 秒粒度流量 → UV（distinct key）。
 *   - 舊社群版的 mgt_attack_log / mgt_detect_log 仍保留為候選（resolveTable 探測）。
 *
 * 安全約定：
 *   - 表名／欄名一律以 sql('identifier') 插入（postgres-js 的安全識別符）；
 *   - 時間下界、LIMIT 等「值」全部用模板參數綁定（$1、$2…）；
 *   - 不含任何寫入語句，所有查詢失敗一律 available:false 降級。
 */
import { isSafelineAvailable, safelineQuery } from './safelinePg'
import {
  SL,
  SAFELINE_ATTACK_TYPES,
  SAFELINE_COUNTRY_NAMES
} from './safelineEnums'

function attackTypeName(code: number): string {
  return SAFELINE_ATTACK_TYPES[code] ?? `类型 ${code}`
}

export interface NameValue {
  name: string
  value: number
}
export interface IpValue {
  ip: string
  value: number
}
export interface SafelineAttackAgg {
  available: boolean
  table: string | null
  total: number
  byType: NameValue[]
  ipTop: IpValue[]
  regions: NameValue[]
}
export interface SafelineHttpAgg {
  available: boolean
  table: string | null
  requests: number
  pv: number
  uv: number
  rate4xx: number
  rate5xx: number
}

function timeValue(startTime: Date | null): Date | number {
  const ms = startTime ? startTime.getTime() : 0
  if (SL.timeMode === 'epochSec') return Math.floor(ms / 1000)
  if (SL.timeMode === 'epochMs') return ms
  return startTime ? startTime : new Date(0)
}

/** 逐一探測候選表；連線層失敗回傳 null（交給上層降級），表不存在則繼續下一個。 */
let lastTableWarnAt = 0
async function resolveTable(candidates: string[]): Promise<string | null> {
  for (const table of candidates) {
    const probe = await safelineQuery((sql) =>
      sql`SELECT to_regclass(${table})::text AS "reg"`
    )
    if (!probe) return null
    const row = Array.isArray(probe) ? probe[0] : null
    if (row?.reg) return table
  }
  // 雷池升級後表名可能變更。靜默降級會讓「資料源不可用」被誤判成「沒有攻擊」，
  // 因此留一條節流告警供監控發現。
  const now = Date.now()
  if (now - lastTableWarnAt > 60_000) {
    lastTableWarnAt = now
    console.warn('[ops-board][safeline] 候選統計表都不存在，雷池聚合降級:', candidates.join(', '))
  }
  return null
}

function toNameValue(rows: unknown): NameValue[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row: any) => ({
    name: String(row?.name ?? '未知'),
    value: Number(row?.value ?? 0)
  }))
}

function toIpValue(rows: unknown): IpValue[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row: any) => ({
    ip: String(row?.ip ?? ''),
    value: Number(row?.value ?? 0)
  }))
}

/** 雷池攻擊事件聚合：攻擊類型、來源 IP Top、地域分佈、總量。 */
export async function queryAttackAgg(
  _range: string,
  startTime: Date | null
): Promise<SafelineAttackAgg> {
  const empty: SafelineAttackAgg = {
    available: false,
    table: null,
    total: 0,
    byType: [],
    ipTop: [],
    regions: []
  }
  if (!isSafelineAvailable()) return empty

  const table = await resolveTable(SL.attackTables)
  if (!table) return empty

  const from = timeValue(startTime)
  const result = await safelineQuery(async (sql) => {
    const [byType, ipTop, regions, total] = await Promise.all([
      // 僅統計真實攻擊分類（attack_type >= 0；負值為白名單/非攻擊等流量標記）
      sql`SELECT ${sql(SL.col.type)}::int AS "name", count(*)::int AS "value"
            FROM ${sql(table)}
           WHERE ${sql(SL.col.time)} >= ${from} AND ${sql(SL.col.type)} >= 0
           GROUP BY ${sql(SL.col.type)}
           ORDER BY "value" DESC LIMIT 20`,
      sql`SELECT ${sql(SL.col.ip)}::text AS "ip", count(*)::int AS "value"
            FROM ${sql(table)}
           WHERE ${sql(SL.col.time)} >= ${from} AND ${sql(SL.col.ip)} IS NOT NULL
           GROUP BY ${sql(SL.col.ip)}
           ORDER BY "value" DESC LIMIT 20`,
      sql`SELECT coalesce(${sql(SL.col.region)}, '未知')::text AS "name", count(*)::int AS "value"
            FROM ${sql(table)}
           WHERE ${sql(SL.col.time)} >= ${from}
           GROUP BY 1 ORDER BY "value" DESC LIMIT 20`,
      sql`SELECT count(*)::int AS "n" FROM ${sql(table)} WHERE ${sql(SL.col.time)} >= ${from}`
    ])
    return { byType, ipTop, regions, total }
  })
  if (!result) return empty

  const totalRow = Array.isArray(result.total) ? result.total[0] : null
  return {
    available: true,
    table,
    total: Number(totalRow?.n ?? 0),
    byType: toNameValue(result.byType).map((item) => {
      const code = Number(item.name)
      return Number.isFinite(code) ? { ...item, name: attackTypeName(code) } : item
    }),
    ipTop: toIpValue(result.ipTop),
    regions: toNameValue(result.regions).map((item) => ({
      ...item,
      name: SAFELINE_COUNTRY_NAMES[item.name] ?? item.name
    }))
  }
}

/**
 * 雷池全量 HTTP 流量聚合（requests / pv / uv / 4xx / 5xx）。
 * rate4xx、rate5xx 為百分比（0~100）。
 *
 * 免費版資料面：
 *   - requests / 4xx / 5xx ← mgt_statistics_agg type='status_code'（key=狀態碼）；
 *   - pv ← 同表 type='pv'（key=content-type，僅頁面類回應）；
 *   - uv ← statistics_ips 的 distinct key（30 秒粒度按 IP 計數）。
 * 聚合表不可用時回退舊版行為：直接掃偵測/攻擊事件表（status_code 列存在時）。
 */
export async function queryHttpTrafficAgg(
  _range: string,
  startTime: Date | null
): Promise<SafelineHttpAgg> {
  const empty: SafelineHttpAgg = {
    available: false,
    table: null,
    requests: 0,
    pv: 0,
    uv: 0,
    rate4xx: 0,
    rate5xx: 0
  }
  if (!isSafelineAvailable()) return empty

  const from = timeValue(startTime)

  // ── 路徑一：聚合表（免費版 9.x）──
  const aggTable = await resolveTable(SL.aggTables)
  if (aggTable) {
    const ipTable = await resolveTable(SL.ipTables)
    const rows = await safelineQuery(async (sql) => {
      const [status, pv, uv] = await Promise.all([
        sql`SELECT key, coalesce(sum(count), 0)::bigint AS "n"
              FROM ${sql(aggTable)}
             WHERE type = 'status_code' AND "time" >= ${from}
             GROUP BY key`,
        sql`SELECT coalesce(sum(count), 0)::bigint AS "n"
              FROM ${sql(aggTable)}
             WHERE type = 'pv' AND "time" >= ${from}`,
        ipTable
          ? sql`SELECT count(DISTINCT key)::int AS "n"
                  FROM ${sql(ipTable)}
                 WHERE "time" >= ${from}`
          : sql`SELECT count(DISTINCT key)::int AS "n"
                  FROM ${sql(aggTable)}
                 WHERE type = 'sl_session' AND "time" >= ${from}`
          // type='sl_session'（session 聚合）已於生產 mgt_statistics_agg 實測存在，
          // 僅在 statistics_ips 缺失的部署上作為 UV 回退。
      ])
      return { status, pv, uv }
    })
    if (!rows) return empty

    const statusRows = Array.isArray(rows.status) ? rows.status : []
    let requests = 0
    let c4xx = 0
    let c5xx = 0
    for (const row of statusRows as any[]) {
      const code = Number(row?.key)
      const n = Number(row?.n ?? 0)
      if (!Number.isFinite(code)) continue
      requests += n
      if (code >= 400 && code <= 499) c4xx += n
      else if (code >= 500) c5xx += n
    }
    const pvRow = Array.isArray(rows.pv) ? rows.pv[0] : null
    const uvRow = Array.isArray(rows.uv) ? rows.uv[0] : null
    const pct = (n: number) =>
      requests > 0 ? Math.round((n / requests) * 10000) / 100 : 0

    return {
      available: true,
      table: aggTable,
      requests,
      pv: Number(pvRow?.n ?? 0),
      uv: Number(uvRow?.n ?? 0),
      rate4xx: pct(c4xx),
      rate5xx: pct(c5xx)
    }
  }

  // ── 路徑二（舊版兜底）：直接掃事件表 ──
  // 僅探測帶 status_code 欄的舊版事件表（mgt_attack_log）；
  // 免費版 mgt_detect_log_basic 沒有該欄，混入候選會讓 SQL 報
  // column "status_code" does not exist，被誤判成連線故障。
  const table = await resolveTable(SL.eventTables)
  if (!table) return empty

  const rows = await safelineQuery((sql) => sql`
    SELECT count(*)::int AS "requests",
           count(DISTINCT ${sql(SL.col.ip)})::int AS "uv",
           count(*) FILTER (WHERE ${sql(SL.col.status)} BETWEEN 400 AND 499)::int AS "c4xx",
           count(*) FILTER (WHERE ${sql(SL.col.status)} >= 500)::int AS "c5xx"
      FROM ${sql(table)}
     WHERE ${sql(SL.col.time)} >= ${from}
  `)
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return empty

  const requests = Number(row.requests || 0)
  const pct = (n: unknown) =>
    requests > 0 ? Math.round((Number(n || 0) / requests) * 10000) / 100 : 0

  return {
    available: true,
    table,
    requests,
    pv: requests,
    uv: Number(row.uv || 0),
    rate4xx: pct(row.c4xx),
    rate5xx: pct(row.c5xx)
  }
}

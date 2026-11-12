/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 雷池 mgt 庫攻擊日誌／全量偵測日誌的只讀聚合。
 *
 * ⚠️⚠️ 表結構需部署時實測後校正 ⚠️⚠️
 *   請在雷池 mgt 庫執行 `\dt` 與 `\d <table>`，把實際表名、欄位名、
 *   時間欄位型態填進下方 SL 常數。社群版常見為攻擊事件表 mgt_attack_log，
 *   全量偵測日誌 mgt_detect_log_*（可能按小時／日分表）。
 *   ATTACK_TABLES / DETECT_TABLES 為候選清單，resolveTable() 會用
 *   to_regclass() 逐一探測（不存在的表回傳 NULL 而非報錯，因此不會誤觸
 *   全域連線降級），取第一個真實存在的表。若表在不同 schema，請一併
 *   校正 search_path 或把 schema 名稱寫入連線字串的 options。
 *
 * 安全約定：
 *   - 表名／欄名一律以 sql('identifier') 插入（postgres-js 的安全識別符）；
 *   - 時間下界、LIMIT 等「值」全部用模板參數綁定（$1、$2…）；
 *   - 不含任何寫入語句，所有查詢失敗一律 available:false 降級。
 */
import { isSafelineAvailable, safelineQuery } from './safelinePg'

export type SafelineTimeMode = 'timestamp' | 'epochMs' | 'epochSec'

export const SL: {
  attackTables: string[]
  detectTables: string[]
  timeMode: SafelineTimeMode
  col: {
    time: string
    ip: string
    type: string
    status: string
    region: string
    host: string
  }
} = {
  attackTables: ['mgt_attack_log'],
  detectTables: ['mgt_detect_log_basic', 'mgt_detect_log'],
  timeMode: 'timestamp',
  col: {
    time: 'timestamp',
    ip: 'src_ip',
    type: 'attack_type',
    status: 'status_code',
    region: 'region',
    host: 'host'
  }
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
async function resolveTable(candidates: string[]): Promise<string | null> {
  for (const table of candidates) {
    const probe = await safelineQuery((sql) =>
      sql`SELECT to_regclass(${table})::text AS "reg"`
    )
    if (!probe) return null
    const row = Array.isArray(probe) ? probe[0] : null
    if (row?.reg) return table
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
      sql`SELECT ${sql(SL.col.type)}::text AS "name", count(*)::int AS "value"
            FROM ${sql(table)}
           WHERE ${sql(SL.col.time)} >= ${from}
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
    byType: toNameValue(result.byType),
    ipTop: toIpValue(result.ipTop),
    regions: toNameValue(result.regions)
  }
}

/**
 * 雷池全量 HTTP 流量聚合（requests / pv / uv / 4xx / 5xx）。
 * rate4xx、rate5xx 為百分比（0~100）；無 page 維度時 pv 以 requests 近似。
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

  const table = await resolveTable(SL.detectTables)
  if (!table) return empty

  const from = timeValue(startTime)
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

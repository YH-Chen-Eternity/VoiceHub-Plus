/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * /api/ops-board/* 共用輔助。Nitro 會忽略底線開頭的檔案，因此本檔不會註冊為路由。
 *
 * 內容：range 解析、no-store、drizzle 時間過濾、查詢降級包裝、
 *       series 骨架，以及 OpsBoardSettings 的參數化 raw SQL 讀寫。
 *
 * 為何用 raw SQL 讀寫 OpsBoardSettings：該表由主 agent 於 schema.ts 建立
 * （契約 §1），本輪並行開發時可能尚未落地。改用參數化 SQL 直接操作
 * "OpsBoardSettings" 可避免對該導出的編譯期依賴，且表未遷移時能降級而非 500。
 * 表名／欄名依契約固定，不含任何外部輸入。
 */
import type { H3Event } from 'h3'
import { defineEventHandler, getQuery, setHeader } from 'h3'
import { gte, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { requireAdmin } from '~~/server/utils/requireAdmin'

export type OpsRange = '24h' | '7d' | '30d' | '1y' | 'all'
export const OPS_RANGES: OpsRange[] = ['24h', '7d', '30d', '1y', 'all']

const RANGE_MS: Record<Exclude<OpsRange, 'all'>, number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
  '1y': 365 * 24 * 3600 * 1000
}
const RANGE_BUCKET_MS: Record<OpsRange, number> = {
  '24h': 5 * 60 * 1000,
  '7d': 60 * 60 * 1000,
  '30d': 6 * 60 * 60 * 1000,
  '1y': 24 * 3600 * 1000,
  all: 24 * 3600 * 1000
}
const ALL_FALLBACK_SPAN_MS = 30 * 24 * 3600 * 1000
export const MAX_SERIES_POINTS = 240

export interface OpsRangeInfo {
  range: OpsRange
  /** null 代表 all（不加時間下界）。 */
  startTime: Date | null
  bucketMs: number
}

export function parseOpsRange(event: H3Event): OpsRangeInfo {
  const query = getQuery(event) as Record<string, unknown>
  const raw = String(query?.range ?? '24h')
  const range: OpsRange = (OPS_RANGES as string[]).includes(raw)
    ? (raw as OpsRange)
    : '24h'
  return {
    range,
    startTime: range === 'all' ? null : new Date(Date.now() - RANGE_MS[range]),
    bucketMs: RANGE_BUCKET_MS[range]
  }
}

export function setOpsBoardNoStore(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
}

export function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 統一的 drizzle 時間下界條件；all 回傳 undefined（drizzle and() 會忽略）。 */
export function timeWhere(column: SQLWrapper, info: OpsRangeInfo): SQL | undefined {
  return info.startTime ? gte(column, info.startTime) : undefined
}

/** 任何資料庫／外部查詢失敗都降級為 fallback，不讓看板 500。 */
export async function safeQuery<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    console.warn(`[ops-board] ${label} 查詢失敗，降級:`, errMessage(error))
    return fallback
  }
}

/** 產生連續時間軸桶（補零後前端可直接畫圖）。 */
export function seriesBuckets(info: OpsRangeInfo, now = Date.now()): number[] {
  const span = info.startTime
    ? Math.max(1, now - info.startTime.getTime())
    : ALL_FALLBACK_SPAN_MS
  const step = Math.max(info.bucketMs, Math.ceil(span / (MAX_SERIES_POINTS - 1)))
  const first = info.startTime ? info.startTime.getTime() : now - span
  const start = Math.floor(first / step) * step
  const buckets: number[] = []
  for (let ts = start; ts <= now; ts += step) {
    buckets.push(ts)
    if (buckets.length >= MAX_SERIES_POINTS) break
  }
  return buckets
}

/** 查詢跨度秒數，供 qps 估算；all 以最近 30 天為展示跨度。 */
export function rangeDurationSeconds(info: OpsRangeInfo, now = Date.now()): number {
  const start = info.startTime ? info.startTime.getTime() : now - ALL_FALLBACK_SPAN_MS
  return Math.max(1, Math.round((now - start) / 1000))
}

// ── OpsBoardSettings（主 agent 建立：pgTable('OpsBoardSettings')）────────────

export interface OpsBoardSettings {
  cosQuotaBytes: number | null
  logRetentionDays: number
  updatedAt: string | null
  /** 表是否可存取；false 代表尚未遷移或資料庫異常，呼叫端應降級。 */
  available: boolean
}

const DEFAULT_SETTINGS: OpsBoardSettings = {
  cosQuotaBytes: null,
  logRetentionDays: 30,
  updatedAt: null,
  available: false
}

/** drizzle postgres-js 的 execute 回傳 RowList（類陣列），相容 .rows 形態。 */
function rowsOf(result: unknown): any[] {
  if (Array.isArray(result)) return result
  const maybe = result as { rows?: unknown } | null
  if (maybe && Array.isArray(maybe.rows)) return maybe.rows as any[]
  return []
}

export async function readOpsBoardSettings(): Promise<OpsBoardSettings> {
  try {
    const result = await db.execute(sql`
      SELECT "cosQuotaBytes", "logRetentionDays", "updatedAt"
        FROM "OpsBoardSettings"
       WHERE "id" = 1
       LIMIT 1
    `)
    const row = rowsOf(result)[0]
    if (!row) {
      // 表存在但尚無 id=1 的列：回傳預設值，首次 PUT 會以 upsert 建立。
      return { ...DEFAULT_SETTINGS, available: true }
    }
    return {
      cosQuotaBytes:
        row.cosQuotaBytes === null || row.cosQuotaBytes === undefined
          ? null
          : Number(row.cosQuotaBytes),
      logRetentionDays: Number(row.logRetentionDays ?? 30),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      available: true
    }
  } catch (error) {
    console.warn('[ops-board] OpsBoardSettings 讀取失敗，使用預設值:', errMessage(error))
    return { ...DEFAULT_SETTINGS }
  }
}

export async function writeOpsBoardSettings(input: {
  cosQuotaBytes?: number | null
  logRetentionDays?: number
}): Promise<{ ok: boolean; settings: OpsBoardSettings }> {
  const current = await readOpsBoardSettings()
  const cosQuotaBytes =
    input.cosQuotaBytes === undefined ? current.cosQuotaBytes : input.cosQuotaBytes
  const logRetentionDays = input.logRetentionDays ?? current.logRetentionDays
  try {
    // 所有值皆以模板參數綁定；固定 id=1，ON CONFLICT 冪等 upsert。
    await db.execute(sql`
      INSERT INTO "OpsBoardSettings"
        ("id", "cosQuotaBytes", "logRetentionDays", "updatedAt")
      VALUES (1, ${cosQuotaBytes}, ${logRetentionDays}, now())
      ON CONFLICT ("id") DO UPDATE SET
        "cosQuotaBytes" = EXCLUDED."cosQuotaBytes",
        "logRetentionDays" = EXCLUDED."logRetentionDays",
        "updatedAt" = now()
    `)
    return { ok: true, settings: await readOpsBoardSettings() }
  } catch (error) {
    console.error('[ops-board] OpsBoardSettings 寫入失敗:', errMessage(error))
    return { ok: false, settings: current }
  }
}

/**
 * 防禦性 default export：不同 Nuxt/Nitro 版本對底線開頭檔案是否忽略路由掃描
 * 行為不一（Nuxt 4 的 ignorePrefix 預設為 `-`）。若本檔真的被註冊為
 * /api/ops-board/_shared，這個 handler 仍要求管理員權限、只回固定訊息，
 * 不會讓 build 失敗、不外洩資料、無副作用。其餘端點只 import 具名導出。
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setOpsBoardNoStore(event)
  return { ok: false, code: 'NOT_A_ROUTE' }
})

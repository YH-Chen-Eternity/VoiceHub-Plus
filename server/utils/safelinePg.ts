/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 雷池（SafeLine）mgt 庫的「獨立只讀」連線通道。
 *
 * 刻意不復用應用主庫 ~/drizzle/db：
 *   - 連線池 max:2、prepare:false，避免看板聚合查詢擠佔業務連線；
 *   - env 缺失、連線失敗、查詢逾時一律降級 available:false，絕不把錯誤拋到端點；
 *   - 本模組只提供查詢入口，不含任何 INSERT/UPDATE/DELETE/設定類呼叫。
 *
 * 部署需提供：SAFELINE_PG_URL（只讀帳號連線字串）。
 */
import postgres from 'postgres'

type SafelineClient = ReturnType<typeof postgres>

const CONNECTION_STRING = String(process.env.SAFELINE_PG_URL || '').trim()
const QUERY_TIMEOUT_MS = 4500
const DOWN_COOLDOWN_MS = 30_000
const WARN_INTERVAL_MS = 60_000

let client: SafelineClient | null = null
let downUntil = 0
let lastWarnAt = 0

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function warnThrottled(...args: unknown[]) {
  const now = Date.now()
  if (now - lastWarnAt < WARN_INTERVAL_MS) return
  lastWarnAt = now
  console.warn(...args)
}

function getClient(): SafelineClient | null {
  if (!CONNECTION_STRING) return null
  if (client) return client
  try {
    client = postgres(CONNECTION_STRING, {
      max: 2,
      prepare: false,
      connect_timeout: 3,
      idle_timeout: 20,
      max_lifetime: 60,
      // 只讀用途：不加 ssl 覆寫，連線字串自帶 sslmode 時由驅動處理；
      // statement_timeout 讓慢查詢在平台硬逾時之前自行失敗。
      connection: {
        application_name: 'voicehub-ops-board-readonly',
        statement_timeout: '4s'
      }
    } as any)
    return client
  } catch (error) {
    warnThrottled('[safeline-pg] 建立連線池失敗，降級為不可用:', errorMessage(error))
    return null
  }
}

/**
 * env 缺失或近期連線/查詢失敗時回傳 false。
 * 注意：postgres-js 連線是惰性的，連線是否真的可用要等第一次查詢才知道；
 * 失敗後以 30 秒冷卻避免每個輪詢都重試壞連線。
 */
export function isSafelineAvailable(): boolean {
  if (!CONNECTION_STRING) return false
  if (Date.now() < downUntil) return false
  return Boolean(getClient())
}

export function markSafelineDown(error: unknown) {
  downUntil = Date.now() + DOWN_COOLDOWN_MS
  warnThrottled('[safeline-pg] 查詢失敗，30 秒內降級:', errorMessage(error))
}

/**
 * 唯一對外查詢入口。callback 收到 postgres-js 的 sql tag（同一個 sql() 也可用
 * sql('identifier') 產生安全識別符）。所有「值」必須用模板參數綁定，
 * 不可與任何外部輸入做字串拼接。失敗/逾時回傳 null，由呼叫端降級。
 */
export async function safelineQuery<T>(
  run: (sql: SafelineClient) => Promise<T>
): Promise<T | null> {
  if (!isSafelineAvailable()) return null
  const sql = getClient()
  if (!sql) return null

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      run(sql),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('safeline query timeout')), QUERY_TIMEOUT_MS)
      })
    ])
    downUntil = 0
    return result
  } catch (error) {
    markSafelineDown(error)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

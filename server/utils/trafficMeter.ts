/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 媒體／COS 出站流量計量（純 Redis，不寫入資料庫）。
 *
 * ── 埋點掛載建議（本輪不掛載，交由主 agent 收尾）────────────────────
 *   建議掛載點：server/api/media/[id].get.ts 等實際輸出媒體位元組的出口。
 *   在拿到實際回應位元組數後呼叫：
 *       void recordTraffic(byteLength, fileKey)
 *   必須 fire-and-forget（不 await）、不得改變既有回應邏輯／快取頭／狀態碼；
 *   函式本身已保證不拋錯、Redis 不可用時靜默略過，因此不會拖慢或中斷媒體回應。
 *   若與 Agent B 的 media 改動衝突，請主 agent 決定唯一掛載位置。
 *
 * ── Key 約定（均經 buildRedisKey 加上 voicehub:v2: 前綴）────────────
 *   traffic:day:YYYYMMDD  → HASH { total:<bytes>, files:<n> }，EXPIRE 400 天
 *   traffic:rank          → ZSET  member=fileKey, score=累計 bytes（總榜）
 *   日期以 Asia/Shanghai（UTC+8，無 DST）分片，與站內時間口徑一致。
 */
import { buildRedisKey, getRedisClient } from './redis'

const DAY_TTL_SECONDS = 400 * 24 * 3600
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 北京時間的 YYYYMMDD。 */
function beijingDayKey(date = new Date()): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '')
}

/** 當月已過的每一天（含今天），不產生未來日期。 */
function monthDayKeys(now = new Date()): string[] {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const today = shifted.getUTCDate()
  const keys: string[] = []
  for (let day = 1; day <= Math.min(today, daysInMonth); day++) {
    keys.push(`${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`)
  }
  return keys
}

function dayKey(name: string): string {
  return buildRedisKey('traffic', 'day', name)
}
function rankKey(): string {
  return buildRedisKey('traffic', 'rank')
}

/**
 * 累加一次出站流量。任何異常都吞掉，絕不影響呼叫端（媒體回應）。
 * @param bytes   實際輸出位元組數（必須為正有限數）
 * @param fileKey 媒體識別鍵，僅作 ZSET member，會截斷至 300 字元
 */
export async function recordTraffic(bytes: number, fileKey: string): Promise<void> {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return
  const amount = Math.round(value)
  const member = String(fileKey || 'unknown').slice(0, 300)
  try {
    const redis = await getRedisClient()
    if (!redis) return
    const today = dayKey(beijingDayKey())
    const rank = rankKey()
    await redis
      .multi()
      .hIncrBy(today, 'total', amount)
      .hIncrBy(today, 'files', 1)
      .zIncrBy(rank, amount, member)
      .expire(today, DAY_TTL_SECONDS)
      .exec()
  } catch (error) {
    console.warn('[traffic-meter] 計量寫入失敗（不影響回應）:', errorMessage(error))
  }
}

export interface TrafficRankItem {
  fileKey: string
  bytes: number
}
export interface TrafficStats {
  /** Redis 計量通道是否可讀；未掛載埋點但 Redis 正常時仍為 true（數值為 0）。 */
  available: boolean
  today: number
  month: number
  filesToday: number
  rank: TrafficRankItem[]
}

export async function getTrafficStats(topN = 10): Promise<TrafficStats> {
  const fallback: TrafficStats = {
    available: false,
    today: 0,
    month: 0,
    filesToday: 0,
    rank: []
  }
  try {
    const redis = await getRedisClient()
    if (!redis) return fallback

    const todayData = await redis.hGetAll(dayKey(beijingDayKey()))
    const monthValues = await Promise.all(
      monthDayKeys().map((name) => redis.hGet(dayKey(name), 'total'))
    )
    const limit = Math.max(1, Math.min(50, Math.floor(topN) || 10))
    const rankRows = await redis.zRangeWithScores(rankKey(), 0, limit - 1, { REV: true })

    return {
      available: true,
      today: Number(todayData?.total || 0),
      month: monthValues.reduce((sum, value) => sum + (Number(value) || 0), 0),
      filesToday: Number(todayData?.files || 0),
      rank: (Array.isArray(rankRows) ? rankRows : []).map((row: any) => ({
        fileKey: String(row?.value ?? ''),
        bytes: Number(row?.score ?? 0)
      }))
    }
  } catch (error) {
    console.warn('[traffic-meter] 計量讀取失敗:', errorMessage(error))
    return fallback
  }
}

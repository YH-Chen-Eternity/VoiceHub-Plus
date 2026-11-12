/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 在線人數與即時 QPS 取樣（全域 middleware，fire-and-forget）。
 *
 * Redis 鍵（皆經 buildRedisKey 加上 voicehub:v2: 前綴，與 realtime.get.ts 共用）：
 *   online:presence      ZSET，member = IP 的 sha256、score = 請求時刻（epoch ms）
 *                        5 分鐘滑窗；每 30 秒惰性清理一次過期 member。
 *   ops:qps:<epoch秒>    每秒 INCR 計數 + EXPIRE 120s，供 realtime 取最近 5 秒平均。
 *
 * 排除：/api/ops-board*（避免看板自身輪詢自我膨脹）、/_nuxt、/__nuxt、
 *       帶常見靜態副檔名的資源。其餘全站請求都計入（含 /api/admin）。
 *
 * 設計取捨：
 *   - 以「去重 IP」為在線口徑，校園 NAT 下會低估；契約允許加 UA 粗指紋，
 *     本輪維持純 IP sha256（不儲存原始 IP，僅雜湊）。
 *   - 不 await Redis、所有錯誤內部吞掉，Redis 未配置或連線失敗時靜默略過，
 *     絕不拖慢或中斷任何業務請求。
 */
import { createHash } from 'node:crypto'
import { defineEventHandler, getRequestURL } from 'h3'
import { getClientIP } from '../utils/ip-utils'
import { buildRedisKey, getRedisClient } from '../utils/redis'

const WINDOW_MS = 5 * 60 * 1000
const CLEANUP_INTERVAL_MS = 30 * 1000
const QPS_KEY_TTL_SECONDS = 120

const STATIC_ASSET = /\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|mp3|mp4|ogg|wav|flac|m4a|webm|pdf|txt|json|gz|br)(?:$|\?)/i

function presenceKey(): string {
  return buildRedisKey('online', 'presence')
}
function qpsKey(epochSecond: number): string {
  return buildRedisKey('ops', 'qps', epochSecond)
}

function shouldSkip(pathname: string): boolean {
  if (pathname.startsWith('/api/ops-board')) return true
  if (pathname.startsWith('/_nuxt') || pathname.startsWith('/__nuxt')) return true
  return STATIC_ASSET.test(pathname)
}

function memberFor(ip: string): string | null {
  if (!ip || ip === 'unknown') return null
  return createHash('sha256').update(ip).digest('hex')
}

let lastCleanupAt = 0

async function sample(ip: string, now: number): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  const member = memberFor(ip)
  if (!member) return

  const presence = presenceKey()
  const second = Math.floor(now / 1000)
  const counter = qpsKey(second)
  await redis
    .multi()
    .zAdd(presence, { score: now, value: member })
    .incr(counter)
    .expire(counter, QPS_KEY_TTL_SECONDS)
    .exec()

  if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
    lastCleanupAt = now
    await redis.zRemRangeByScore(presence, 0, now - WINDOW_MS)
  }
}

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  if (shouldSkip(pathname)) return

  // 取樣完全非阻塞：Redis 狀態不影響請求延遲與成功率。
  void (async () => {
    try {
      await sample(getClientIP(event), Date.now())
    } catch {
      // 取樣失敗不影響業務
    }
  })()
})

/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 在线人数分钟级采样，供运维看板的「时段峰值在线人数」使用。
 *
 * 為何需要取樣：middleware/10.online-presence.ts 只在 Redis ZSET 裡保留
 * 近 5 分鐘窗口，過去的在線人數會被滑窗淘汰，無法事後查詢歷史峰值。
 * 這裡每分鐘把窗口內的去重 IP 數落一條到 OpsBoardOnlineSample，
 * 口徑與實時卡片完全一致（同一 ZSET、同一 5 分鐘窗口）。
 *
 * 設計取捨：
 *   - Redis 不可用時直接跳過該分鐘，不寫 0：寫 0 會在曲線上造成假低谷，
 *     也無法與「當分鐘確實沒人」區分。
 *   - 同一分鐘桶 upsert 覆蓋，多實例或重啟後補寫都冪等。
 *   - 取樣與清理都不 await 業務請求，錯誤全部內部吞掉。
 */
import { lt, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { opsBoardOnlineSamples } from '~/drizzle/schema'
import { buildRedisKey, getRedisClient } from '~~/server/utils/redis'

const SAMPLE_INTERVAL_MS = 60 * 1000
const PRESENCE_WINDOW_MS = 5 * 60 * 1000
const RETENTION_DAYS = 400
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const STARTUP_DELAY_MS = 20 * 1000

async function sampleOnce(): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return

  const now = Date.now()
  const online = Number(
    await redis.zCount(buildRedisKey('online', 'presence'), now - PRESENCE_WINDOW_MS, now)
  )
  if (!Number.isFinite(online) || online < 0) return

  // 對齊到分鐘桶起點，同一分鐘重複取樣只留最後一次結果。
  const bucketAt = Math.floor(now / 60000) * 60000
  await db
    .insert(opsBoardOnlineSamples)
    .values({ bucketAt, online })
    .onConflictDoUpdate({
      target: opsBoardOnlineSamples.bucketAt,
      set: { online: sql`excluded."online"` }
    })
}

async function purgeOldSamples(): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  await db.delete(opsBoardOnlineSamples).where(lt(opsBoardOnlineSamples.bucketAt, cutoff))
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default defineNitroPlugin(() => {
  let sampling = false
  const tick = async () => {
    if (sampling) return
    sampling = true
    try {
      await sampleOnce()
    } catch (error) {
      console.warn('[ops-board] 在线人数采样失败:', errText(error))
    } finally {
      sampling = false
    }
  }

  const first = setTimeout(tick, STARTUP_DELAY_MS)
  first.unref?.()
  const sampler = setInterval(tick, SAMPLE_INTERVAL_MS)
  sampler.unref?.()

  const cleanup = async () => {
    try {
      await purgeOldSamples()
    } catch (error) {
      console.warn('[ops-board] 在线采样清理失败:', errText(error))
    }
  }
  const firstCleanup = setTimeout(cleanup, 3 * 60 * 1000)
  firstCleanup.unref?.()
  const cleaner = setInterval(cleanup, CLEANUP_INTERVAL_MS)
  cleaner.unref?.()
})

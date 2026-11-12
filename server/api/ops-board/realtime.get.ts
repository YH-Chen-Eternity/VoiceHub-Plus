/**
 * 即時在線人數與 QPS。資料源：10.online-presence.ts 維護的 Redis ZSET／每秒計數。
 */
import { defineEventHandler } from 'h3'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { buildRedisKey, getRedisClient } from '~~/server/utils/redis'
import { setOpsBoardNoStore } from './_shared'

const WINDOW_MS = 5 * 60 * 1000
const SAMPLE_SECONDS = 5

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setOpsBoardNoStore(event)

  const unavailable = {
    online: 0,
    qpsRealtime: 0,
    available: false,
    window: '5min',
    sampledSeconds: SAMPLE_SECONDS
  }
  try {
    const redis = await getRedisClient()
    if (!redis) return unavailable

    const now = Date.now()
    const presence = buildRedisKey('online', 'presence')
    const online = await redis.zCount(presence, now - WINDOW_MS, now)

    const seconds = Array.from(
      { length: SAMPLE_SECONDS },
      (_, index) => Math.floor(now / 1000) - index
    )
    const counts = await Promise.all(
      seconds.map((second) => redis.get(buildRedisKey('ops', 'qps', second)))
    )
    const total = counts.reduce((sum, value) => sum + (Number(value) || 0), 0)
    const qpsRealtime = Math.round((total / SAMPLE_SECONDS) * 10) / 10

    return {
      online: Number(online) || 0,
      qpsRealtime,
      available: true,
      window: '5min',
      sampledSeconds: SAMPLE_SECONDS
    }
  } catch (error) {
    console.warn(
      '[ops-board] realtime 讀取失敗，降級:',
      error instanceof Error ? error.message : String(error)
    )
    return unavailable
  }
})

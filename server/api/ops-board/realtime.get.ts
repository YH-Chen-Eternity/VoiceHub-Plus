/**
 * 即時在線人數與 QPS。資料源：10.online-presence.ts 維護的 Redis ZSET／每秒計數。
 * 另附「時段峰值在線人數」：取自 online-peak-sampler.ts 落庫的每分鐘取樣，
 * 按 ?range= 取該區間內的最大值，供前端在即時卡片內對照。
 */
import { defineEventHandler } from 'h3'
import { asc, desc, gte } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { opsBoardOnlineSamples } from '~/drizzle/schema'
import { requireOpsBoardViewer } from '~~/server/utils/opsBoardViewer'
import { buildRedisKey, getRedisClient } from '~~/server/utils/redis'
import { parseOpsRange, safeQuery, setOpsBoardNoStore } from './_shared'

const WINDOW_MS = 5 * 60 * 1000
const SAMPLE_SECONDS = 5

interface PeakOnline {
  /** 區間內峰值在線人數；null 表示該區間尚無取樣。 */
  online: number | null
  /** 峰值出現的時刻（epoch ms）。 */
  at: number | null
  /** 全表最早一條取樣的時刻，用於向使用者說明統計起點。 */
  since: number | null
  range: string
  /** 取樣粒度（分鐘）。 */
  sampleMinutes: number
}

async function readPeak(info: ReturnType<typeof parseOpsRange>): Promise<PeakOnline> {
  const since = await safeQuery<number | null>(
    'realtime:peak-since',
    async () => {
      const [row] = await db
        .select({ bucketAt: opsBoardOnlineSamples.bucketAt })
        .from(opsBoardOnlineSamples)
        .orderBy(asc(opsBoardOnlineSamples.bucketAt))
        .limit(1)
      return row ? Number(row.bucketAt) : null
    },
    null
  )

  const top = await safeQuery<{ bucketAt: number; online: number } | null>(
    'realtime:peak',
    async () => {
      const where = info.startTime
        ? gte(opsBoardOnlineSamples.bucketAt, info.startTime.getTime())
        : undefined
      const [row] = await db
        .select({
          bucketAt: opsBoardOnlineSamples.bucketAt,
          online: opsBoardOnlineSamples.online
        })
        .from(opsBoardOnlineSamples)
        .where(where)
        .orderBy(desc(opsBoardOnlineSamples.online), asc(opsBoardOnlineSamples.bucketAt))
        .limit(1)
      return row ? { bucketAt: Number(row.bucketAt), online: Number(row.online) } : null
    },
    null
  )

  return {
    online: top ? top.online : null,
    at: top ? top.bucketAt : null,
    since,
    range: info.range,
    sampleMinutes: 1
  }
}

export default defineEventHandler(async (event) => {
  await requireOpsBoardViewer(event)
  setOpsBoardNoStore(event)

  const info = parseOpsRange(event)
  const peak = await readPeak(info)

  const unavailable = {
    online: 0,
    qpsRealtime: 0,
    available: false,
    window: '5min',
    sampledSeconds: SAMPLE_SECONDS,
    peak
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
      sampledSeconds: SAMPLE_SECONDS,
      peak
    }
  } catch (error) {
    console.warn(
      '[ops-board] realtime 讀取失敗，降級:',
      error instanceof Error ? error.message : String(error)
    )
    return unavailable
  }
})

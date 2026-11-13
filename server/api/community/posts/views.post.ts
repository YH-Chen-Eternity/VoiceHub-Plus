import { readBody } from 'h3'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPostViews, communityPosts } from '~/drizzle/schema'
import {
  getCommunityViewer,
  getGuestVisibleBoardIds,
  isCommunityGuest
} from '~~/server/utils/community'
import { getGuestRateKey, recordGuestViews } from '~~/server/utils/guestView'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'

/** 单次上报的最大帖子数：客户端按批合并，避免滚动时每个卡片一个请求 */
const MAX_BATCH = 40

/** 每个上报者的每分钟上限：单批最多 40 条，多标签页同时浏览时 120 会误伤 */
const RATE_LIMIT_PER_MINUTE = 300

/**
 * 列表曝光计浏览（「在外面看到也算一次」）。
 *
 * 与详情页 /api/community/posts/[id] 共用同一套去重口径：
 * 登录用户按 (postId,userId) 永久去重，游客按 签名 cookie 匿名 id + 小时桶 去重。
 * 所以「列表里看到」和「点进详情」不会重复 +1，同一个人反复刷列表也不会涨。
 *
 * 该接口只做弱校验与静默失败：它是后台统计，失败绝不打扰用户阅读。
 */
export default defineEventHandler(async (event) => {
  const user = getCommunityViewer(event)
  const guest = isCommunityGuest(event)

  const body = await readBody(event).catch(() => null)
  const rawIds = Array.isArray(body?.ids) ? body.ids : []
  const ids = [...new Set(rawIds.map((value: unknown) => Number(value)))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, MAX_BATCH)
  if (!ids.length) return { success: true, viewCounts: {} }

  // 曝光上报只是统计，超限直接不计数，不返回 429 影响页面。
  // 游客按匿名 cookie 哈希限流（反代后 IP 全站相同，按 IP 会误伤全体游客）。
  const rateKey = guest
    ? `community_view:guest:${getGuestRateKey(event)}`
    : `community_view:user:${user.id}`
  const limit = await checkDistributedRateLimit(rateKey, RATE_LIMIT_PER_MINUTE, 60 * 1000).catch(() => null)
  if (limit && !limit.isAllowed) return { success: true, viewCounts: {} }

  // 只统计当前读者真正能看到的帖子：已通过、未删除；游客还要落在「游客可见」板块内
  const conditions: any[] = [
    inArray(communityPosts.id, ids),
    eq(communityPosts.status, 'APPROVED'),
    isNull(communityPosts.deletedAt)
  ]
  if (guest) {
    const guestBoardIds = await getGuestVisibleBoardIds()
    if (!guestBoardIds.length) return { success: true, viewCounts: {} }
    conditions.push(inArray(communityPosts.boardId, guestBoardIds))
  }

  const visible = await db
    .select({ id: communityPosts.id })
    .from(communityPosts)
    .where(and(...conditions))
  const visibleIds = visible.map((row) => Number(row.id))
  if (!visibleIds.length) return { success: true, viewCounts: {} }

  let countedIds: number[] = []
  if (guest) {
    countedIds = await recordGuestViews(event, visibleIds)
  } else {
    try {
      const inserted = await db
        .insert(communityPostViews)
        .values(visibleIds.map((postId) => ({ postId, userId: user.id })))
        .onConflictDoNothing()
        .returning({ postId: communityPostViews.postId })
      countedIds = inserted.map((row) => Number(row.postId))
    } catch {
      countedIds = []
    }
  }
  if (!countedIds.length) return { success: true, viewCounts: {} }

  // 每条 +1，一条 UPDATE 搞定；返回最新值给前端就地刷新小眼睛
  const updated = await db
    .update(communityPosts)
    .set({ viewCount: sql`${communityPosts.viewCount} + 1` })
    .where(inArray(communityPosts.id, countedIds))
    .returning({ id: communityPosts.id, viewCount: communityPosts.viewCount })

  const viewCounts: Record<string, number> = {}
  for (const row of updated) viewCounts[String(row.id)] = Number(row.viewCount || 0)

  return { success: true, viewCounts }
})

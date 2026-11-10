import { getRouterParam } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPostViews, communityPosts, communityProfiles } from '~/drizzle/schema'
import {
  getCommunityViewer,
  getReviewableBoardIds,
  isCommunityAdmin,
  isCommunityGuest,
  isCommunityReviewer
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { getCommunityPostById } from '~~/server/utils/communityFeed'
import { recordGuestView } from '~~/server/utils/guestView'

export default defineEventHandler(async (event) => {
  const user = getCommunityViewer(event)
  const guest = isCommunityGuest(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const post = await getCommunityPostById(postId, user.id, user.role)
  if (!post) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')

  // 审帖员只能读取自己负责板块的未公开帖子
  const scopedBoardIds = await getReviewableBoardIds(user)
  const canReviewBoard = !scopedBoardIds || scopedBoardIds.includes(post.board.id)
  const privileged = canReviewBoard && (isCommunityReviewer(user) || isCommunityAdmin(user))
  if (post.status !== 'APPROVED' && post.author.id !== user.id && !privileged) {
    throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
  }

  // 影子封禁：仅作者本人与管理员/审帖员可见
  if (!privileged && post.author.id !== user.id) {
    const [shadow] = await db
      .select({ shadowBanned: communityProfiles.shadowBanned })
      .from(communityProfiles)
      .where(eq(communityProfiles.userId, post.author.id))
      .limit(1)
    if (shadow?.shadowBanned) {
      throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
    }
  }

  // 浏览量：登录用户按 (postId,userId) 永久去重；游客用签名 cookie 匿名 id + 小时桶去重。
  // 两者都用数据库唯一键 + onConflictDoNothing 原子判定，重启/多实例都不会重复计数。
  let counted = false
  if (post.status === 'APPROVED') {
    if (guest) {
      counted = await recordGuestView(event, postId)
    } else {
      try {
        const inserted = await db
          .insert(communityPostViews)
          .values({ postId, userId: user.id })
          .onConflictDoNothing()
          .returning({ postId: communityPostViews.postId })
        counted = inserted.length > 0
      } catch {
        counted = false
      }
    }
  }
  if (counted) {
    const [updated] = await db
      .update(communityPosts)
      .set({ viewCount: sql`${communityPosts.viewCount} + 1` })
      .where(eq(communityPosts.id, postId))
      .returning({ viewCount: communityPosts.viewCount })
    post.viewCount = Number(updated?.viewCount ?? (Number(post.viewCount || 0) + 1))
  }

  return { success: true, post }
})

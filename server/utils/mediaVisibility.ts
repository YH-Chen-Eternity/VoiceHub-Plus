import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { announcements, communityPostImages, communityPosts } from '~/drizzle/schema'

/**
 * 媒体资源的「公共可见性」判定：仅两类资源允许匿名/CDN 直取——
 *   1. 已启用公告的配图；
 *   2. 已通过审核、未删除且作者未被影子封禁的帖子配图。
 * 未审核 / 已删除 / 影子封禁帖的图片一律不可见，调用方按「资源不存在」处理（404），
 * 避免泄露资源是否存在。
 *
 * 该判定同时被鉴权读取端点（/api/media/{id}）与公开 CDN 端点（/api/public/media/{id}）使用，
 * 两边口径必须完全一致，统一收敛在这里。
 */
export async function isMediaPubliclyVisible(mediaId: number): Promise<boolean> {
  if (!Number.isInteger(mediaId) || mediaId <= 0) return false

  const [announcementRef] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(and(eq(announcements.imageId, mediaId), eq(announcements.enabled, true)))
    .limit(1)
  if (announcementRef) return true

  const [postImage] = await db
    .select({ postId: communityPostImages.postId })
    .from(communityPostImages)
    .innerJoin(communityPosts, eq(communityPosts.id, communityPostImages.postId))
    .where(
      and(
        eq(communityPostImages.mediaId, mediaId),
        eq(communityPosts.status, 'APPROVED'),
        isNull(communityPosts.deletedAt),
        // 影子封禁作者的帖子仅本人与管理员可见，其图片同样不对匿名访客开放。
        // 用 drizzle 列引用而非硬编码表名，确保 join 别名由查询构建器正确生成（与社区 feed 口径一致）
        sql`not exists (select 1 from "CommunityProfile" cp where cp."userId" = ${communityPosts.authorId} and cp."shadowBanned" = true)`
      )
    )
    .limit(1)
  return !!postImage
}

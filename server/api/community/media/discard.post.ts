import { readBody } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { announcements, communityPostImages, mediaAssets } from '~/drizzle/schema'
import { requireCommunityEnabled, requireCommunityUser } from '~~/server/utils/community'
import { deleteMediaFiles } from '~~/server/utils/mediaStorage'

/** 单次放弃草稿最多清理的图片数，与前端草稿上限对齐 */
const MAX_DISCARD = 500

/**
 * 放弃发帖草稿时清理「已上传但尚未发布」的孤儿图片。
 *
 * 安全口径（与归档清理 purgePostMedia 一致）：
 * - 只接受正整数 id，且必须是当前登录用户上传的；
 * - 已被帖子图片或公告引用的图片一律保留，避免删除已发布内容；
 * - 先删库记录再删私有目录文件；deleteMediaFiles 内部对每个文件独立容错，
 *   单文件失败只记日志、不抛出，与归档清理 purgePostMedia 口径一致。
 *   极端情况下可能残留无库记录的孤儿文件，可按日志中的路径回收；
 *   不采用「先删文件再删库」，以免产生「文件已删、记录仍在」的坏数据；
 * - 发稿员豁免的是频率限流，不是归属校验，这里同样按 uploadedBy 严格校验。
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  await requireCommunityEnabled()

  const body = await readBody(event)
  const rawIds = Array.isArray(body?.ids) ? body.ids : []
  const ids = Array.from(
    new Set(
      rawIds
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isInteger(id) && id > 0)
    )
  ).slice(0, MAX_DISCARD) as number[]

  if (!ids.length) return { success: true, deleted: [] }

  const owned = await db
    .select({
      id: mediaAssets.id,
      storagePath: mediaAssets.storagePath,
      previewPath: mediaAssets.previewPath
    })
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.uploadedBy, user.id)))

  if (!owned.length) return { success: true, deleted: [] }

  const ownedIds = owned.map((row) => row.id)
  const [usedByPosts, usedByAnnouncements] = await Promise.all([
    db
      .select({ mediaId: communityPostImages.mediaId })
      .from(communityPostImages)
      .where(inArray(communityPostImages.mediaId, ownedIds)),
    db
      .select({ imageId: announcements.imageId })
      .from(announcements)
      .where(inArray(announcements.imageId, ownedIds))
  ])

  const stillUsed = new Set<number>([
    ...usedByPosts.map((row) => Number(row.mediaId)),
    ...usedByAnnouncements
      .map((row) => (row.imageId == null ? null : Number(row.imageId)))
      .filter((id): id is number => id != null)
  ])

  const removable = owned.filter((row) => !stillUsed.has(Number(row.id)))
  if (!removable.length) return { success: true, deleted: [] }

  const removableIds = removable.map((row) => row.id)
  await db.delete(mediaAssets).where(inArray(mediaAssets.id, removableIds))
  await deleteMediaFiles(
    removable.flatMap((row) => [row.storagePath, row.previewPath])
  ).catch((error) => {
    // deleteMediaFiles 目前逐项容错、不会抛出；此处仅在它未来改为抛出时兜底记日志，
    // 不回滚已完成的数据库删除，避免留下「文件已删、记录仍在」的不可用记录
    console.warn('[community-media] 孤儿图片文件清理失败:', error)
  })

  return { success: true, deleted: removableIds }
})

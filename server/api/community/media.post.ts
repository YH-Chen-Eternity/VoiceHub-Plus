import { readMultipartFormData } from 'h3'
import { and, count, eq, gte } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { mediaAssets } from '~/drizzle/schema'
import {
  assertCommunityNotMuted,
  requireCommunityEnabled,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import {
  COMMUNITY_IMAGE_MAX_UPLOAD_BYTES,
  normalizeCommunityImage
} from '~~/server/utils/communityImage'
import { findReusableMediaAsset, hashMediaData } from '~~/server/utils/mediaDedup'
import { deleteMediaFiles, saveMediaFiles } from '~~/server/utils/mediaStorage'

const DAILY_LIMIT = 30

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await requireCommunityEnabled()
  if (!settings.allowImages) {
    throw createApiError(403, 'COMMUNITY_IMAGES_DISABLED', '当前不允许发布图片')
  }
  await assertCommunityNotMuted(user.id)

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const used = await db
    .select({ value: count() })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.uploadedBy, user.id), gte(mediaAssets.createdAt, since)))
  if (Number(used[0]?.value || 0) >= DAILY_LIMIT) {
    throw createApiError(429, 'COMMUNITY_MEDIA_DAILY_LIMIT', '今天上传的图片太多了，请明天再试')
  }

  // multipart 会整体读入内存，先按声明的长度拒绝明显超限的请求
  const declaredLength = Number(getHeader(event, 'content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > COMMUNITY_IMAGE_MAX_UPLOAD_BYTES + 512 * 1024) {
    throw createApiError(413, 'MEDIA_TOO_LARGE', '图片原始文件不能超过 15MB')
  }

  const form = await readMultipartFormData(event)
  const file = form?.find((part) => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createApiError(400, 'MEDIA_NO_FILE', '请选择要上传的图片')
  }

  const mime = String(file.type || '').toLowerCase()
  if (file.data.length > COMMUNITY_IMAGE_MAX_UPLOAD_BYTES) {
    throw createApiError(400, 'MEDIA_TOO_LARGE', '图片原始文件不能超过 15MB')
  }

  // 类型与内容校验、去元数据、「尽量无损」重编码、派生预览图统一在此完成
  const normalized = await normalizeCommunityImage({
    data: file.data,
    mimeType: mime,
    filename: file.filename || 'community-upload'
  })

  // 同一上传者的相同图片直接复用已有记录，避免重复占库/占盘
  const sha256 = hashMediaData(normalized.data)
  const existing = await findReusableMediaAsset({ sha256, uploadedBy: user.id })
  if (existing) {
    return {
      success: true,
      id: existing.id,
      url: `/api/media/${existing.id}`,
      byteSize: existing.byteSize,
      compressed: normalized.compressed,
      reused: true
    }
  }

  // 先落库拿 id（文件路径由 id + sha256 生成），再写私有目录文件，最后回填相对路径。
  // 不再写入 base64：数据库只保存相对路径索引，图片字节落在不可直连的私有目录。
  const [row] = await db
    .insert(mediaAssets)
    .values({
      filename: normalized.filename,
      mimeType: normalized.mimeType,
      byteSize: normalized.data.length,
      sha256,
      uploadedBy: user.id
    })
    .returning({ id: mediaAssets.id })

  if (!row) {
    throw createApiError(500, 'MEDIA_SAVE_FAILED', '图片保存失败，请稍后重试')
  }

  let storagePath = ''
  let previewPath = ''
  try {
    const paths = await saveMediaFiles({
      id: row.id,
      sha256,
      original: normalized.data,
      preview: normalized.preview
    })
    storagePath = paths.storagePath
    previewPath = paths.previewPath
    await db
      .update(mediaAssets)
      .set({ storagePath, previewPath: previewPath || null })
      .where(eq(mediaAssets.id, row.id))
  } catch (error) {
    // 写文件失败不能留下无字节的孤儿记录：清理文件与记录，保持数据一致
    await deleteMediaFiles([storagePath, previewPath])
    await db.delete(mediaAssets).where(eq(mediaAssets.id, row.id))
    console.error('[community-media] 图片落盘失败:', error)
    throw createApiError(500, 'MEDIA_SAVE_FAILED', '图片保存失败，请稍后重试')
  }

  return {
    success: true,
    id: row.id,
    url: `/api/media/${row.id}`,
    byteSize: normalized.data.length,
    compressed: normalized.compressed,
    reused: false
  }
})

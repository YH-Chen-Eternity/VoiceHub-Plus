// Copyright (C) 2026 YH-Chen
//
// This file is part of VoiceHub-Plus (an unofficial community edition),
// based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
import { readMultipartFormData } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { mediaAssets } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { normalizeUploadedImage } from '~~/server/utils/imageSecurity'
import { findReusableMediaAsset, hashMediaData } from '~~/server/utils/mediaDedup'
import { deleteMediaFiles, saveMediaFiles } from '~~/server/utils/mediaStorage'

// 图片上传：校验后落到私有目录 + 通过 /api/media/[id] 鉴权后转发。
// 不写 base64（体积太大），不放 public/CDN（运行时新增文件 404 且可绕过鉴权直连）。
// 公告图片沿用原有有损阶梯与 2MB 上限，与社区「尽量无损」策略互不影响。
const MAX_BYTES = 2 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '权限不足')
  }

  // multipart 会整体读入内存，先按声明的长度拒绝明显超限的请求
  const declaredLength = Number(getHeader(event, 'content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES + 256 * 1024) {
    throw createApiError(413, 'MEDIA_TOO_LARGE', '图片不能超过 2MB，请先压缩')
  }

  const form = await readMultipartFormData(event)
  const file = form?.find((part) => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createApiError(400, 'MEDIA_NO_FILE', '请选择要上传的图片')
  }

  const mime = String(file.type || '').toLowerCase()
  if (file.data.length > MAX_BYTES) {
    throw createApiError(400, 'MEDIA_TOO_LARGE', '图片不能超过 2MB，请先压缩')
  }

  // 与社区图片共用同一套安全处理：魔数校验 + 完整解码 + 去元数据重编码为 WebP
  const normalized = await normalizeUploadedImage({
    data: file.data,
    mimeType: mime,
    filename: file.filename || 'announcement-image',
    maxBytes: MAX_BYTES,
    fallbackName: 'announcement-image'
  })

  // 同一上传者的相同图片直接复用已有记录（公告图片也走这套去重）
  const sha256 = hashMediaData(normalized.data)
  const existing = await findReusableMediaAsset({ sha256, uploadedBy: user.id })
  if (existing) {
    return { success: true, id: existing.id, url: `/api/media/${existing.id}`, reused: true }
  }

  // 先落库拿 id（文件路径由 id + sha256 生成），再写私有目录文件并回填相对路径
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
  try {
    // 公告图片不需要预览图
    const paths = await saveMediaFiles({ id: row.id, sha256, original: normalized.data })
    storagePath = paths.storagePath
    await db
      .update(mediaAssets)
      .set({ storagePath, previewPath: null })
      .where(eq(mediaAssets.id, row.id))
  } catch (error) {
    await deleteMediaFiles([storagePath])
    await db.delete(mediaAssets).where(eq(mediaAssets.id, row.id))
    console.error('[admin-media] 图片落盘失败:', error)
    throw createApiError(500, 'MEDIA_SAVE_FAILED', '图片保存失败，请稍后重试')
  }

  return { success: true, id: row.id, url: `/api/media/${row.id}`, reused: false }
})

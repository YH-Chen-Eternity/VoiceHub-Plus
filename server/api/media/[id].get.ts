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
import { getQuery, getRouterParam, setResponseHeaders } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { mediaAssets } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { verifyMediaToken } from '~~/server/utils/mediaToken'
import { isMediaPubliclyVisible } from '~~/server/utils/mediaVisibility'
import {
  detectImageFormat,
  imageFormatToMimeType,
  sanitizeDownloadFilename
} from '~~/server/utils/imageSecurity'
import { readMediaFile } from '~~/server/utils/mediaStorage'

/**
 * 图片读取端点：唯一对外吐字节的出口，私有目录/CND 都无法直连。
 *
 * 可见性顺序（沿用原有设计，失败一律 404，避免泄露资源是否存在）：
 *   管理员/审帖员 → 上传者 → 阿里云审核签名令牌(?mt=) → 公共可见资源（已启用公告 / 已通过且未删除的帖子，
 *   公共口径统一由 server/utils/mediaVisibility.ts 提供，与公开 CDN 端点一致）。
 * 公共可见资源允许公共缓存。
 *
 * variant=preview 返回更小的预览图（新上传才有；缺失时回退原图）；
 * 不带 variant 返回压缩后 ≤3MB 的「原图」——阿里云审核的 ?mt= 拉图不带 variant，
 * 因此审查始终拿到完整质量图片，链路不受存储改造影响。
 * download=1 返回 attachment（游客同样可下载原图），并禁用公共缓存，
 * 避免 attachment 响应被共享缓存串味给普通查看请求。
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '参数错误')
  }

  const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1)
  if (!row) {
    throw createApiError(404, 'MEDIA_NOT_FOUND', '图片不存在')
  }

  const query = getQuery(event)
  const wantDownload = query.download === '1' || query.download === 'true'
  const wantPreview = query.variant === 'preview'

  const viewer = event.context.user
  const privileged =
    !!viewer && ['ADMIN', 'SUPER_ADMIN', 'REVIEWER'].includes(String(viewer.role || ''))
  const hasMediaToken = verifyMediaToken(id, query.mt)
  let allowed = privileged || (!!viewer && row.uploadedBy === viewer.id) || hasMediaToken
  let isPublic = false

  if (!allowed) {
    // 公共可见口径（已启用公告 / 已通过且未删除的帖子配图）与公开 CDN 端点完全一致
    allowed = await isMediaPubliclyVisible(id)
    isPublic = allowed
  }

  if (!allowed) {
    throw createApiError(404, 'MEDIA_NOT_FOUND', '图片不存在')
  }

  // 字节来源：新上传走私有目录文件；历史数据回退库内 base64（读取端点不依赖 sharp）。
  // 预览缺失/读取失败一律回退原图，绝不因缩略图问题让图片打不开。
  let data: Buffer | null = null
  if (wantPreview && row.previewPath) {
    data = await readMediaFile(row.previewPath)
  }
  if (!data && row.storagePath) {
    data = await readMediaFile(row.storagePath)
  }
  if (!data && row.data) {
    data = Buffer.from(row.data, 'base64')
  }
  if (!data) {
    throw createApiError(404, 'MEDIA_NOT_FOUND', '图片不存在')
  }

  // 不信任库中 mimeType，按字节魔数复检；文件被篡改成 HTML/脚本时返回 415
  const format = detectImageFormat(data)
  if (!format) {
    throw createApiError(415, 'MEDIA_CONTENT_UNSUPPORTED', '图片内容不合法，无法展示')
  }

  const disposition = wantDownload ? 'attachment' : 'inline'
  const filename = sanitizeDownloadFilename(row.filename, format)
  // 下载响应禁共享缓存（防止 attachment 头被复用），其余按 isPublic 决定是否可公共缓存
  const cacheable = !wantDownload && isPublic

  setResponseHeaders(event, {
    'Content-Type': imageFormatToMimeType(format),
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${disposition}; filename="${filename}"`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': cacheable ? 'public, max-age=2592000, immutable' : 'private, no-store',
    // 公开图按完整 URL（含 variant）缓存；私有/下载响应按 Cookie 区分，绝不进共享缓存
    'Vary': cacheable ? 'Accept-Encoding' : 'Cookie'
  })
  return data
})

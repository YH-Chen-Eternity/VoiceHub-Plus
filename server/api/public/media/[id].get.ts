import { getQuery, getRouterParam, setResponseHeaders } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { mediaAssets } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { isMediaPubliclyVisible } from '~~/server/utils/mediaVisibility'
import {
  detectImageFormat,
  imageFormatToMimeType
} from '~~/server/utils/imageSecurity'
import { readMediaFile } from '~~/server/utils/mediaStorage'

/**
 * 公开图片 CDN 端点：仅吐「公共可见」的图片字节，供浏览器与前置 CDN 直接缓存。
 *
 * 与 /api/media/{id} 的区别：
 *   - 不读取登录态、不区分角色：只有公共可见资源（已启用公告 / 已通过且未删除的帖子配图）
 *     能从这里出去，口径统一由 server/utils/mediaVisibility.ts 提供；
 *   - 响应恒为 public 缓存（download=1 时除外），配合 ETag/304 支持 CDN 边缘复用；
 *   - 不携带 Cookie，命中缓存不受会话影响。
 *
 * 未审核 / 已删除 / 影子封禁帖的图片从这里访问一律 404，与鉴权端点同等口径，
 * 避免泄露资源是否存在。variant=preview 返回预览图（缺失回退原图）。
 * download=1 返回 attachment（游客同样可下载原图），此时禁用公共缓存，
 * 避免 attachment 响应被共享缓存串味给普通查看请求。
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '参数错误')
  }

  const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1)
  if (!row || !(await isMediaPubliclyVisible(id))) {
    throw createApiError(404, 'MEDIA_NOT_FOUND', '图片不存在')
  }

  const query = getQuery(event)
  const wantDownload = query.download === '1' || query.download === 'true'
  const wantPreview = query.variant === 'preview'

  // 字节来源与鉴权端点一致：私有目录文件优先，历史数据回退库内 base64
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

  // ETag 用入库时的内容哈希（查看原图与预览图字节不同，ETag 按 variant 区分），
  // 历史数据 sha256 可能为空，此时退回 id + 字节量组成稳定键，避免缓存键冲突；
  // 支持浏览器/CDN 协商缓存：内容不变时命中 304，不再回源传输字节
  const etagSource = row.sha256 || `id-${row.id}-${row.byteSize}`
  const etag = `"${etagSource}-${wantPreview ? 'preview' : 'full'}"`
  const ifNoneMatch = String(getHeader(event, 'if-none-match') || '')
  if (ifNoneMatch && ifNoneMatch.split(',').map((v) => v.trim()).includes(etag)) {
    setResponseHeaders(event, {
      'ETag': etag,
      'Cache-Control': 'public, max-age=2592000',
      'Vary': 'Accept-Encoding'
    })
    event.node.res.statusCode = 304
    return null
  }

  setResponseHeaders(event, {
    'Content-Type': imageFormatToMimeType(format),
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': wantDownload
      ? // attachment 响应禁公共缓存，防止被共享缓存串味给普通查看请求
        'private, no-store'
      : 'public, max-age=2592000, immutable',
    'Vary': wantDownload ? 'Cookie' : 'Accept-Encoding',
    'ETag': etag
  })
  if (wantDownload) {
    setResponseHeaders(event, {
      'Content-Disposition': `attachment; filename="voicehub-image-${id}.${format === 'jpeg' ? 'jpg' : format}"`
    })
  }
  return data
})

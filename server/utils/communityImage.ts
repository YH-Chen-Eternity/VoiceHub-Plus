import { createApiError } from './apiError'
import {
  buildPreviewImage,
  normalizeUploadedImage,
  type NormalizedImage
} from './imageSecurity'

// 社区图片：入库体积上限 3MB（「查看原图」展示的那份），原始上传上限 15MB
export const COMMUNITY_IMAGE_MAX_BYTES = 3 * 1024 * 1024
export const COMMUNITY_IMAGE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
// 预览图（九宫格缩略图 / 灯箱默认展示）体积上限，明显小于 3MB
export const COMMUNITY_IMAGE_PREVIEW_MAX_BYTES = 512 * 1024

export type NormalizedCommunityImage = NormalizedImage & {
  /** 更小的预览图；生成失败时为 null，读取端点会回退展示原图 */
  preview: Buffer | null
}

/**
 * 规范化社区上传图片：魔数校验、完整解码、去元数据，并走「尽量无损」阶梯重编码为 WebP，
 * 必要时压缩到 3MB 内；同时由原图派生一份更小的预览图。
 * 安全逻辑统一由 server/utils/imageSecurity.ts 提供。
 */
export async function normalizeCommunityImage(params: {
  data: Buffer
  mimeType: string
  filename: string
}): Promise<NormalizedCommunityImage> {
  if (!Buffer.isBuffer(params.data) || params.data.length === 0) {
    throw createApiError(400, 'MEDIA_NO_FILE', '请选择要上传的图片')
  }
  if (params.data.length > COMMUNITY_IMAGE_MAX_UPLOAD_BYTES) {
    throw createApiError(400, 'MEDIA_TOO_LARGE', '图片原始文件不能超过 15MB')
  }

  const normalized = await normalizeUploadedImage({
    data: params.data,
    mimeType: params.mimeType,
    filename: params.filename,
    maxBytes: COMMUNITY_IMAGE_MAX_BYTES,
    fallbackName: 'community-image',
    // 社区图片尽量无损：优先原尺寸无损 WebP，装不下才降质量/尺寸
    lossless: true
  })

  const preview = await buildPreviewImage(normalized.data, {
    maxBytes: COMMUNITY_IMAGE_PREVIEW_MAX_BYTES
  })

  return { ...normalized, preview }
}

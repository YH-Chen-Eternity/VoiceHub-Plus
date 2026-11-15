/**
 * 社区图片压缩 Worker：与主线程解耦，避免大批量选图时压缩阻塞 UI。
 *
 * 职责仅两件：文件头魔数校验（防伪装文件）、把 >3MB 的静态图在 Worker 内
 * 压到 3MB 内（createImageBitmap + OffscreenCanvas + WebP）。不支持的环境
 * 原样回传字节，由主线程 compressCommunityImageFile 回退处理。
 *
 * 消息协议：
 *   入: { id, buffer, mime, filename, maxBytes, maxUploadBytes, maxPixels, qualities, downscaleSteps }
 *   出: { id, ok, buffer, mime, filename, compressed, reason? }
 *   reason: 'unsupported' | 'mismatch' | 'too-large' | 'compress-failed'
 */
import { validateImageHeader, MAGIC_HEADER_BYTES } from '../utils/communityImageMagic.js'

function reply(payload, transfer) {
  self.postMessage(payload, transfer || [])
}

self.onmessage = async (event) => {
  const {
    id, buffer, mime, filename,
    maxBytes, maxUploadBytes, maxPixels,
    qualities, downscaleSteps
  } = event.data || {}

  let bitmap = null
  try {
    const bytes = new Uint8Array(buffer)
    const check = validateImageHeader(bytes.subarray(0, MAGIC_HEADER_BYTES), mime)
    if (!check.ok) {
      reply({ id, ok: false, reason: check.reason })
      return
    }
    if (bytes.length > maxUploadBytes) {
      reply({ id, ok: false, reason: 'too-large' })
      return
    }

    const passthrough = () =>
      reply({ id, ok: true, buffer, mime, filename, compressed: false }, [buffer])

    // 小图 / GIF / 环境不支持：直接回传原字节，主线程按需回退
    if (
      bytes.length <= maxBytes ||
      mime === 'image/gif' ||
      typeof createImageBitmap !== 'function' ||
      typeof OffscreenCanvas === 'undefined'
    ) {
      passthrough()
      return
    }

    try {
      bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), {
        imageOrientation: 'from-image'
      })
    } catch {
      bitmap = await createImageBitmap(new Blob([bytes], { type: mime }))
    }

    const sourceWidth = bitmap.width
    const sourceHeight = bitmap.height
    if (sourceWidth * sourceHeight > maxPixels) {
      passthrough()
      return
    }

    const attempts = [
      ...(qualities || []).map((quality) => ({ scale: 1, quality })),
      ...(downscaleSteps || []).map((step) => ({
        scale: Math.min(1, step.maxDimension / Math.max(sourceWidth, sourceHeight)),
        quality: step.quality
      }))
    ]

    for (const attempt of attempts) {
      const width = Math.max(1, Math.round(sourceWidth * attempt.scale))
      const height = Math.max(1, Math.round(sourceHeight * attempt.scale))
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) break
      context.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: attempt.quality })
      if (blob.size <= maxBytes) {
        // 只有真的更小才采用，避免小图重编码反而变大
        if (blob.size >= bytes.length) break
        const out = new Uint8Array(await blob.arrayBuffer())
        const stem = String(filename || '').replace(/\.[^.]+$/, '') || 'community-image'
        reply(
          {
            id, ok: true, buffer: out.buffer, mime: 'image/webp',
            filename: `${stem}.webp`, compressed: true
          },
          [out.buffer]
        )
        return
      }
    }
    passthrough()
  } catch {
    reply({ id, ok: false, reason: 'compress-failed' })
  } finally {
    bitmap?.close?.()
  }
}

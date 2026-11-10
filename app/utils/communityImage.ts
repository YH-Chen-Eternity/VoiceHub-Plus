export const COMMUNITY_IMAGE_MAX_BYTES = 3 * 1024 * 1024
export const COMMUNITY_IMAGE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024

const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
// 与服务端 COMMUNITY_LOSSY_ATTEMPTS 对齐：先保持原尺寸逐级降质量，质量到下限仍超标才降尺寸兜底，
// 质量全程单调不回升（尺寸是画质最大杀手，降尺寸永远排在最后）；导出以便测试直接比对口径
export const FULL_SIZE_QUALITIES = [0.92, 0.86, 0.8, 0.74]
export const DOWNSCALE_STEPS = [
  { maxDimension: 2560, quality: 0.74 },
  { maxDimension: 2048, quality: 0.68 },
  { maxDimension: 1600, quality: 0.62 },
  { maxDimension: 1280, quality: 0.56 },
  { maxDimension: 1024, quality: 0.5 }
]
// 与服务端一致的解码像素上限，超限图不做本地预压缩（服务端会明确拒绝并提示）
export const MAX_PIXELS = 40 * 1000 * 1000

export function isCommunityImageType(type: string): boolean {
  return SUPPORTED_TYPES.includes(String(type || '').toLowerCase())
}

/**
 * 浏览器本地预压缩：超过 3MB 的静态图先在本地压到 3MB 内再上传，节省上行流量、加快发布。
 *
 * - 阶段与质量档位和服务端有损阶梯保持一致，服务端拿到后先走无损重编码校验，
 *   装不下再按同档位有损兜底，最终入库体积仍由服务端硬保证 ≤3MB；
 * - GIF 保留原文件交给服务端按动画压缩，避免浏览器丢失动画帧；
 * - 编码环境不支持（无 createImageBitmap / canvas / WebP 编码）或压缩结果不比原图小，
 *   一律回退原图直传，绝不因预压缩失败阻断上传。
 */
export async function compressCommunityImageFile(
  file: File
): Promise<{ file: File; compressed: boolean }> {
  if (file.size <= COMMUNITY_IMAGE_MAX_BYTES) return { file, compressed: false }
  if (file.type === 'image/gif') return { file, compressed: false }
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return { file, compressed: false }
  }

  let bitmap: ImageBitmap | null = null
  try {
    // imageOrientation 旧浏览器不支持该选项会抛错，此时降级为不带选项解码再试一次
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      bitmap = await createImageBitmap(file)
    }
    const sourceWidth = bitmap.width
    const sourceHeight = bitmap.height
    if (sourceWidth * sourceHeight > MAX_PIXELS) return { file, compressed: false }

    const attempts = [
      ...FULL_SIZE_QUALITIES.map((quality) => ({ scale: 1, quality })),
      ...DOWNSCALE_STEPS.map((step) => ({
        scale: Math.min(1, step.maxDimension / Math.max(sourceWidth, sourceHeight)),
        quality: step.quality
      }))
    ]

    for (const attempt of attempts) {
      const width = Math.max(1, Math.round(sourceWidth * attempt.scale))
      const height = Math.max(1, Math.round(sourceHeight * attempt.scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) break
      context.drawImage(bitmap, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', attempt.quality)
      })
      if (blob && blob.size <= COMMUNITY_IMAGE_MAX_BYTES) {
        // 只有真的更小才采用，否则回退原图（避免小图重编码反而变大）
        if (blob.size >= file.size) break
        const filename = file.name.replace(/\.[^.]+$/, '') || 'community-image'
        return {
          file: new File([blob], `${filename}.webp`, { type: 'image/webp' }),
          compressed: true
        }
      }
    }
  } catch (error) {
    // 浏览器不支持或解码失败时退回原图，由服务端 sharp 处理；记录日志便于排查
    console.warn('[community] 本地预压缩失败，回退原图直传:', error)
  } finally {
    bitmap?.close?.()
  }

  return { file, compressed: false }
}

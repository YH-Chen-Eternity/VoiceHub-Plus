/**
 * 社区图片文件头魔数校验（主线程 / Web Worker / Node 测试共用的单一来源）。
 *
 * 与服务端 server/utils/imageSecurity.ts 的 detectImageFormat 口径严格对齐：
 * 只认 PNG / JPEG / WebP / GIF，且要求声明的 MIME 与真实文件头一致。
 * 这是上传前的第一道防线，用于拦截「改扩展名伪装成图片」的文件；
 * 服务端仍会独立做魔数校验、完整解码、重编码与元数据剥离，不信任前端结论。
 */

export const SUPPORTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const MIME_TO_FORMAT = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

/** 至少需要前 12 字节才能判定 RIFF....WEBP */
export const MAGIC_HEADER_BYTES = 12

function toBytes(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  return null
}

/** 按文件头识别真实格式；不支持或数据不足返回 null */
export function detectImageMagic(input) {
  const data = toBytes(input)
  if (!data || data.length < MAGIC_HEADER_BYTES) return null

  if (
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
    data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  ) return 'png'

  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg'

  const riff = String.fromCharCode(data[0], data[1], data[2], data[3])
  const webp = String.fromCharCode(data[8], data[9], data[10], data[11])
  if (riff === 'RIFF' && webp === 'WEBP') return 'webp'

  const gif = String.fromCharCode(data[0], data[1], data[2], data[3], data[4], data[5])
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif'

  return null
}

/**
 * 校验文件头与声明的 MIME 是否匹配。
 * 返回 { ok, format, reason }；reason 为 'unsupported' | 'mismatch'。
 */
export function validateImageHeader(input, mimeType) {
  const declared = MIME_TO_FORMAT[String(mimeType || '').toLowerCase()]
  if (!declared) return { ok: false, format: null, reason: 'unsupported' }
  const format = detectImageMagic(input)
  if (!format) return { ok: false, format: null, reason: 'unsupported' }
  if (format !== declared) return { ok: false, format, reason: 'mismatch' }
  return { ok: true, format, reason: null }
}

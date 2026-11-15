import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectImageMagic,
  validateImageHeader,
  SUPPORTED_IMAGE_MIME,
  MAGIC_HEADER_BYTES
} from '../../app/utils/communityImageMagic.js'

/** 构造带合法文件头、补足 12 字节的最小样本 */
function header(bytes: number[], fill = 0): Uint8Array {
  const out = new Uint8Array(Math.max(MAGIC_HEADER_BYTES, bytes.length)).fill(fill)
  out.set(bytes)
  return out
}

const PNG = header([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = header([0xff, 0xd8, 0xff, 0xe0])
const WEBP = header([...'RIFF'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...'WEBP'.split('').map((c) => c.charCodeAt(0))])
const GIF = header('GIF89a'.split('').map((c) => c.charCodeAt(0)))

test('detectImageMagic 识别四种受支持格式，口径与服务端一致', () => {
  assert.equal(detectImageMagic(PNG), 'png')
  assert.equal(detectImageMagic(JPEG), 'jpeg')
  assert.equal(detectImageMagic(WEBP), 'webp')
  assert.equal(detectImageMagic(GIF), 'gif')
  assert.equal(detectImageMagic(header('GIF87a'.split('').map((c) => c.charCodeAt(0)))), 'gif')
})

test('detectImageMagic 拒绝伪装文件与截断文件', () => {
  assert.equal(detectImageMagic(header('MZ'.split('').map((c) => c.charCodeAt(0)))), null, 'EXE 头不应被识别')
  assert.equal(detectImageMagic(header([0x3c, 0x73, 0x63, 0x72])), null, 'HTML 头不应被识别')
  assert.equal(detectImageMagic(new Uint8Array(8)), null, '数据不足 12 字节应返回 null')
  assert.equal(detectImageMagic(null), null)
  // PNG 魔数被截断 1 字节
  assert.equal(detectImageMagic(PNG.subarray(0, 7)), null)
})

test('validateImageHeader 拒绝 MIME 与真实文件头不符的伪装文件', () => {
  assert.deepEqual(validateImageHeader(PNG, 'image/png'), { ok: true, format: 'png', reason: null })
  // 关键防线：把可执行/脚本文件改名为 .png
  const fake = header('MZ'.split('').map((c) => c.charCodeAt(0)))
  assert.equal(validateImageHeader(fake, 'image/png').reason, 'unsupported')
  // 真实 PNG 却声明为 jpeg
  assert.deepEqual(validateImageHeader(PNG, 'image/jpeg'), { ok: false, format: 'png', reason: 'mismatch' })
  // 声明类型本身不受支持
  assert.equal(validateImageHeader(PNG, 'image/svg+xml').reason, 'unsupported')
  assert.equal(validateImageHeader(PNG, 'application/octet-stream').reason, 'unsupported')
})

test('四种声明 MIME 各自与对应魔数匹配', () => {
  const pairs: Array<[string, Uint8Array, string]> = [
    ['image/png', PNG, 'png'],
    ['image/jpeg', JPEG, 'jpeg'],
    ['image/webp', WEBP, 'webp'],
    ['image/gif', GIF, 'gif']
  ]
  for (const [mime, bytes, format] of pairs) {
    assert.deepEqual(validateImageHeader(bytes, mime), { ok: true, format, reason: null })
  }
  assert.deepEqual(SUPPORTED_IMAGE_MIME, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
})

test('validateImageHeader 接受 Uint8Array / ArrayBuffer / Buffer 三种输入', () => {
  assert.equal(validateImageHeader(PNG, 'image/png').ok, true)
  assert.equal(validateImageHeader(PNG.buffer, 'image/png').ok, true)
  assert.equal(validateImageHeader(Buffer.from(PNG), 'image/png').ok, true)
})

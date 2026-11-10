import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMUNITY_IMAGE_MAX_BYTES,
  MAX_PIXELS,
  DOWNSCALE_STEPS,
  FULL_SIZE_QUALITIES,
  compressCommunityImageFile,
  isCommunityImageType
} from '../../app/utils/communityImage.ts'

const makeFile = (size: number, type: string, name = 'photo.png') =>
  new File([new Uint8Array(size)], name, { type })

test('不支持的类型被拒绝，支持的类型放行', () => {
  assert.equal(isCommunityImageType('image/png'), true)
  assert.equal(isCommunityImageType('image/jpeg'), true)
  assert.equal(isCommunityImageType('image/webp'), true)
  assert.equal(isCommunityImageType('image/gif'), true)
  assert.equal(isCommunityImageType('image/bmp'), false)
  assert.equal(isCommunityImageType('text/html'), false)
})

test('小图与 GIF 不做本地预压缩（GIF 动画帧由服务端保留）', async () => {
  const small = makeFile(1024, 'image/png')
  const smallRes = await compressCommunityImageFile(small)
  assert.equal(smallRes.compressed, false)
  assert.equal(smallRes.file, small, '小图应原样返回')

  const gif = makeFile(COMMUNITY_IMAGE_MAX_BYTES + 1024, 'image/gif')
  const gifRes = await compressCommunityImageFile(gif)
  assert.equal(gifRes.compressed, false)
  assert.equal(gifRes.file, gif, 'GIF 应原样返回')
})

test('非浏览器环境（无 createImageBitmap/canvas）安全回退原图', async () => {
  const big = makeFile(COMMUNITY_IMAGE_MAX_BYTES + 1024, 'image/jpeg')
  const res = await compressCommunityImageFile(big)
  assert.equal(res.compressed, false)
  assert.equal(res.file, big, '无法本地压缩时应回退原图，绝不阻断上传')
})

test('本地压缩阶梯与服务端有损阶梯口径一致：先保尺寸降质量，后降尺寸兜底', () => {
  // 质量全程单调不回升：全尺寸 0.92→0.74，降尺寸阶段 0.74→0.5
  assert.deepEqual(FULL_SIZE_QUALITIES, [0.92, 0.86, 0.8, 0.74])
  assert.deepEqual(
    DOWNSCALE_STEPS.map((step) => step.maxDimension),
    [2560, 2048, 1600, 1280, 1024]
  )
  assert.deepEqual(
    DOWNSCALE_STEPS.map((step) => step.quality),
    [0.74, 0.68, 0.62, 0.56, 0.5]
  )
  const allQualities = [...FULL_SIZE_QUALITIES, ...DOWNSCALE_STEPS.map((step) => step.quality)]
  for (let i = 1; i < allQualities.length; i += 1) {
    assert.ok(allQualities[i]! <= allQualities[i - 1]!, '质量必须单调不回升')
  }
  // 与服务端一致的 3MB 目标体积与 40MP 像素上限
  assert.equal(COMMUNITY_IMAGE_MAX_BYTES, 3 * 1024 * 1024)
  assert.equal(MAX_PIXELS, 40 * 1000 * 1000)
})

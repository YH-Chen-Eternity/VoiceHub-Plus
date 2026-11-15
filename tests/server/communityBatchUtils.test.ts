import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_IMAGES_PER_POST,
  computePostHash,
  hashCommunityContent,
  mapWithConcurrency,
  resolveImagesPerPost,
  splitImageGroups,
  summarizeBatchStatus,
  validatePostInput
} from '../../server/utils/communityPostBatch.ts'

test('resolveImagesPerPost 收敛到 [1,9]，非法值回落 9', () => {
  assert.equal(resolveImagesPerPost(9), 9)
  assert.equal(resolveImagesPerPost(3), 3)
  assert.equal(resolveImagesPerPost(99), MAX_IMAGES_PER_POST)
  assert.equal(resolveImagesPerPost(0), MAX_IMAGES_PER_POST)
  assert.equal(resolveImagesPerPost(-1), MAX_IMAGES_PER_POST)
  assert.equal(resolveImagesPerPost('abc'), MAX_IMAGES_PER_POST)
  assert.equal(resolveImagesPerPost(undefined), MAX_IMAGES_PER_POST)
})

test('splitImageGroups 精确按上限切分，余数单独成帖，组数不设上限', () => {
  const ids = Array.from({ length: 23 }, (_, i) => i + 1)
  const groups = splitImageGroups(ids, 9)
  assert.deepEqual(groups.map((g) => g.length), [9, 9, 5])
  assert.deepEqual(groups.flat(), ids, '分组不丢图、不重排')
  // 大量图片也不被截断
  const many = Array.from({ length: 1000 }, (_, i) => i + 1)
  const manyGroups = splitImageGroups(many, 9)
  assert.equal(manyGroups.length, Math.ceil(1000 / 9))
  assert.deepEqual(manyGroups.flat(), many)
})

test('splitImageGroups 纯文字帖返回单组空数组，保证至少发一帖', () => {
  assert.deepEqual(splitImageGroups([], 9), [[]])
})

test('computePostHash 有正文沿用正文 hash，纯图帖按图片集合去重', () => {
  assert.equal(computePostHash('Hello!', [1, 2]), hashCommunityContent('Hello!'))
  assert.equal(computePostHash('  ', [3, 1, 2]), computePostHash('', [2, 1, 3]), '纯图帖图片顺序无关')
  assert.notEqual(computePostHash('', [1, 2]), computePostHash('', [1, 2, 3]), '不同图片集合不应判为重复')
  assert.equal(hashCommunityContent('A b!'), hashCommunityContent('ab'), '忽略空白与标点')
})

test('validatePostInput 允许纯文字帖与纯图帖，拒绝空帖与超长', () => {
  assert.equal(validatePostInput('hi', 0, 1000), null)
  assert.equal(validatePostInput('', 3, 1000), null, '纯图帖应放行')
  assert.equal(validatePostInput('', 0, 1000), 'COMMUNITY_CONTENT_REQUIRED')
  assert.equal(validatePostInput('x'.repeat(101), 0, 100), 'COMMUNITY_CONTENT_TOO_LONG')
})

test('mapWithConcurrency 保序、限并发、失败整体抛出', async () => {
  const items = Array.from({ length: 10 }, (_, i) => i)
  let running = 0
  let peak = 0
  const result = await mapWithConcurrency(items, 3, async (n) => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 1))
    running -= 1
    return n * 2
  })
  assert.deepEqual(result, items.map((n) => n * 2))
  assert.ok(peak <= 3, `并发不应超过上限，实际峰值 ${peak}`)
  await assert.rejects(
    mapWithConcurrency(items, 2, async (n) => {
      if (n === 4) throw new Error('boom')
      return n
    }),
    /boom/
  )
})

test('summarizeBatchStatus 拦截优先于待审', () => {
  assert.equal(summarizeBatchStatus(['APPROVED', 'PENDING']), 'PENDING')
  assert.equal(summarizeBatchStatus(['APPROVED', 'BLOCKED']), 'BLOCKED')
  assert.equal(summarizeBatchStatus(['APPROVED']), 'APPROVED')
  assert.equal(summarizeBatchStatus(['PENDING', 'BLOCKED']), 'BLOCKED')
})

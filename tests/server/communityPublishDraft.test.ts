import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMUNITY_DRAFT_VERSION,
  COMMUNITY_DRAFT_TTL_MS,
  collectUploadedImageIds,
  countPendingImages,
  countUploadedImages,
  isDraftUsable,
  makeDraftImageKey,
  markDraftUploaded,
  mergeDraftImages,
  removeDraftImage,
  toStorableDraft,
  type DraftImage,
  type PublishDraft
} from '../../app/utils/communityPublishDraft.ts'

const image = (key: string, extra: Partial<DraftImage> = {}): DraftImage => ({
  key,
  name: `${key}.png`,
  size: 100,
  type: 'image/png',
  ...extra
})

test('makeDraftImageKey 对同名同大小同修改时间的文件稳定', () => {
  const a = { name: 'a.png', size: 100, lastModified: 1, type: 'image/png' }
  assert.equal(makeDraftImageKey(a), makeDraftImageKey({ ...a }))
  assert.notEqual(makeDraftImageKey(a), makeDraftImageKey({ ...a, size: 101 }))
})

test('mergeDraftImages 按 key 去重，不覆盖已上传成功的 id', () => {
  const existing = [image('a', { id: 11, url: '/api/media/11' })]
  const merged = mergeDraftImages(existing, [image('a'), image('b')])
  assert.equal(merged.length, 2)
  assert.equal(merged[0]!.id, 11, '已上传项不应被新选的同名文件覆盖')
  assert.equal(merged[1]!.key, 'b')
})

test('mergeDraftImages 受上限约束，且上限为 0 时返回空', () => {
  const many = ['a', 'b', 'c', 'd'].map((key) => image(key))
  assert.equal(mergeDraftImages([], many, 2).length, 2)
  assert.deepEqual(mergeDraftImages([], many, 0), [])
})

test('markDraftUploaded 写回 id/url 并释放 blob', () => {
  const blob = new Blob(['x'])
  const images = [image('a', { blob })]
  const next = markDraftUploaded(images, 'a', 9, '/api/media/9')
  assert.equal(next[0]!.id, 9)
  assert.equal(next[0]!.url, '/api/media/9')
  assert.equal(next[0]!.blob, undefined)
  assert.equal(images[0]!.blob, blob, '不得修改原数组')
})

test('removeDraftImage 只移除指定 key', () => {
  assert.deepEqual(removeDraftImage([image('a'), image('b')], 'a').map((i) => i.key), ['b'])
})

test('collectUploadedImageIds 去重并排除未完成项', () => {
  const images = [
    image('a', { id: 3 }),
    image('b', { id: 3 }),
    image('c'),
    image('d', { id: 7 })
  ]
  assert.deepEqual(collectUploadedImageIds(images), [3, 7])
  assert.equal(countUploadedImages(images), 3)
  assert.equal(countPendingImages([image('a', { blob: new Blob(['x']) }), image('b', { id: 1 })]), 1)
})

test('isDraftUsable 校验版本、时限、结构', () => {
  const now = Date.now()
  const draft: PublishDraft = {
    version: COMMUNITY_DRAFT_VERSION,
    boardId: 1,
    content: 'hi',
    nameMode: 'semi',
    song: null,
    images: [],
    updatedAt: now
  }
  assert.equal(isDraftUsable(draft, now), true)
  assert.equal(isDraftUsable({ ...draft, version: 0 }, now), false)
  assert.equal(isDraftUsable({ ...draft, updatedAt: now - COMMUNITY_DRAFT_TTL_MS - 1 }, now), false)
  assert.equal(isDraftUsable({ ...draft, images: undefined }, now), false)
  assert.equal(isDraftUsable({ ...draft, content: undefined }, now), false)
  assert.equal(isDraftUsable(null, now), false)
})

test('toStorableDraft 丢弃 Blob 与临时预览 URL，保留已上传 id', () => {
  const storable = toStorableDraft({
    version: COMMUNITY_DRAFT_VERSION,
    boardId: 1,
    content: '',
    nameMode: 'semi',
    song: null,
    images: [
      image('a', { id: 5, url: '/api/media/5', blob: new Blob(['x']), previewUrl: 'blob:x' }),
      image('b', { blob: new Blob(['y']), previewUrl: 'blob:y' })
    ],
    updatedAt: Date.now()
  })
  assert.equal(storable.images[0]!.id, 5)
  assert.equal(storable.images[0]!.url, '/api/media/5')
  assert.ok(!('blob' in storable.images[0]!))
  assert.ok(!('previewUrl' in storable.images[0]!))
  assert.ok(!('blob' in storable.images[1]!))
  assert.doesNotThrow(() => JSON.stringify(storable))
})

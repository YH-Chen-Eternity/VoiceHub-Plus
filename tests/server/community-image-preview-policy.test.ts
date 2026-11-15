import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 社区图片「默认缩略图、点查看原图才拉原图」回归守卫。
 *
 * 多图批量拆帖只新增 communityPost 行并复用同一批 mediaId，
 * 不得改动 communityPostImages 结构与图片组装口径，否则列表宫格 / 帖子归档 /
 * 审核队列会退化为直接加载 3MB 原图。本测试锁住整条链路的默认预览图口径。
 */
const repoRoot = process.cwd()
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf-8')

test('feed 图片组装：thumbUrl 指向 variant=preview，且列表宫格优先用缩略图', () => {
  const feed = read('server/utils/communityFeed.ts')
  assert.match(
    feed,
    /thumbUrl:\s*`\$\{url\}\?variant=preview`/,
    'loadCommunityPosts 应为每张图生成预览图 thumbUrl'
  )
  const card = read('app/components/Community/CommunityFeed.vue')
  assert.match(card, /image\.thumbUrl \?\? image\.url/, '帖子卡片默认应渲染缩略图')
})

test('帖子归档：宫格默认缩略图，后台端点同样下发 thumbUrl', () => {
  const archiveApi = read('server/api/admin/community/archive.get.ts')
  assert.match(
    archiveApi,
    /thumbUrl:\s*`\$\{url\}\?variant=preview`/,
    '归档端点应下发预览图 thumbUrl'
  )
  const archiveUi = read('app/components/Admin/CommunityArchive.vue')
  assert.match(archiveUi, /image\.thumbUrl \?\? image\.url/, '归档宫格默认应渲染缩略图')
})

test('审核队列：复用 loadCommunityPosts 的默认预览图口径，宫格优先缩略图', () => {
  const reviewApi = read('server/api/community/review/posts.get.ts')
  assert.match(reviewApi, /loadCommunityPosts\(/, '审核列表应复用统一的帖子组装函数')
  assert.match(reviewApi, /moderationView:\s*true/, '审核列表应走审核视图')
  const reviewUi = read('app/components/Admin/CommunityReview.vue')
  assert.match(reviewUi, /image\.thumbUrl \?\? image\.url/, '审核宫格默认应渲染缩略图')
})

test('图片查看器：未点查看原图时显示预览图，仅 showOriginal 才用原图', () => {
  const viewer = read('app/components/Community/CommunityImageViewer.vue')
  assert.match(
    viewer,
    /showOriginal\.value\s*\?\s*baseUrl\.value\s*:\s*withVariant\(baseUrl\.value,\s*'preview'\)/,
    '查看器应默认预览图、点查看原图才切换原图'
  )
  assert.match(viewer, /viewOriginal/, '查看器应保留「查看原图」入口')
})

test('批量拆帖不改变图片存储结构：仍按 mediaId 关联、单帖图片数受上限约束', () => {
  const schema = read('app/drizzle/schema.ts')
  assert.match(
    schema,
    /mediaId: integer\('mediaId'\)\.notNull\(\)\.references\(\(\) => mediaAssets\.id, \{ onDelete: 'cascade' \}\)/,
    'CommunityPostImage 仍以 mediaId 外键关联 MediaAsset'
  )
  const batch = read('server/utils/communityPostBatch.ts')
  assert.match(batch, /MAX_IMAGES_PER_POST = 9/, '每帖图片数仍受硬上限约束')
  const post = read('server/api/community/posts/index.post.ts')
  assert.match(post, /tx\.insert\(communityPostImages\)\.values\(/, '批量发帖仍写入同一张关联表')
})

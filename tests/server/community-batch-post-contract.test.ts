import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 社区发帖批量拆帖的后端契约（静态源码断言，不连 DB）。
 *
 * 需求口径：
 * - allowMultiImageBatch 开关只控制「是否允许超过单帖上限并自动拆帖」；
 * - 纯图帖、并行审核/复用等均为通用能力，不受开关影响；
 * - 一次请求、单事务建 N 帖，全成功或全回滚；
 * - 发稿员豁免频率限流仍保留；整批只计一次额度。
 */
const repoRoot = process.cwd()
const src = readFileSync(join(repoRoot, 'server/api/community/posts/index.post.ts'), 'utf-8')
const batch = readFileSync(join(repoRoot, 'server/utils/communityPostBatch.ts'), 'utf-8')

test('开关只用于判定是否放行超上限图片，不介入其它链路', () => {
  const occurrences = src.split('allowMultiImageBatch').length - 1
  assert.equal(occurrences, 1, '发帖端点应只在一处读取批量开关')
  assert.match(
    src,
    /const batchEnabled = settings\.allowMultiImageBatch === true/,
    '开关应显式读取为布尔值'
  )
  assert.match(
    src,
    /if \(!batchEnabled && imageIds\.length > imagesPerPost\)/,
    '开关关闭时按单帖上限拒绝超量图片'
  )
  // 除「声明 batchEnabled」这一行外，限流 / 纯图校验 / 审核 / 查重不得引用开关
  const gateIdx = src.indexOf('const batchEnabled = settings.allowMultiImageBatch')
  const beforeGate = src.slice(0, gateIdx)
  const afterGate = src.slice(src.indexOf('\n', gateIdx))
  assert.ok(
    !beforeGate.includes('allowMultiImageBatch'),
    '限流与内容校验等通用逻辑不得依赖批量开关'
  )
  assert.equal(
    afterGate.split('allowMultiImageBatch').length - 1,
    0,
    '开关声明之后不得再次读取开关（后续链路与开关无关）'
  )
})

test('纯图帖在所有发帖场景放开：正文与图片至少其一', () => {
  assert.match(src, /validatePostInput\(content, imageIds\.length, settings\.maxContentLength\)/)
  assert.match(batch, /if \(!content && imageCount === 0\) return 'COMMUNITY_CONTENT_REQUIRED'/)
  assert.match(batch, /if \(content\.length > maxContentLength\) return 'COMMUNITY_CONTENT_TOO_LONG'/)
})

test('按每组图片数切分，组数不设上限；单事务整批建帖', () => {
  assert.match(src, /const groups = splitImageGroups\(imageIds, imagesPerPost\)/)
  assert.match(batch, /for \(let i = 0; i < imageIds\.length; i \+= size\)/)
  assert.match(src, /db\.transaction\(async \(tx\) => \{/, '整批应在一个事务内建帖')
  const txIdx = src.indexOf('db.transaction(')
  const txBody = src.slice(txIdx, src.indexOf('const status = summarizeBatchStatus', txIdx))
  assert.match(txBody, /tx\s*\.?\s*insert\(communityPosts\)|\.insert\(communityPosts\)/, '事务内插入帖子')
  assert.match(txBody, /\.insert\(communityPostImages\)/, '事务内插入图片关联')
  assert.match(txBody, /for \(let index = 0; index < groups\.length/, '按分组逐帖创建')
})

test('整批共享去重指纹，批次内各帖互不判重', () => {
  const computeIdx = src.indexOf('const batchHash = computePostHash')
  const dupIdx = src.indexOf('const [duplicatePost]')
  assert.ok(computeIdx > 0 && dupIdx > computeIdx, '应在查重前计算整批指纹')
  assert.match(src, /eq\(communityPosts\.contentHash, batchHash\)/)
  assert.match(src, /contentHash: batchHash/, '各帖写入同一整批指纹')
  assert.equal(src.split('duplicatePost').length - 1 >= 2, true, '查重只做一次')
})

test('审核结果按组复用：文本只审一次、每张图只审一次', () => {
  assert.match(src, /buildModerationResolver/, '整批共用审核器')
  assert.match(src, /imageCache = new Map/, '图片审核结果按 id 缓存复用')
  assert.match(src, /textPromise/, '文本审核结果复用')
  assert.match(src, /mapWithConcurrency\(groups, MODERATION_CONCURRENCY/, '按组并发审核')
})

test('发稿员豁免频率限流，且整批只计一次额度', () => {
  assert.match(src, /if \(!isCommunityRateLimitExempt\(user\)\) \{/)
  const limitIdx = src.indexOf('checkDistributedRateLimit(')
  const groupsIdx = src.indexOf('const groups = splitImageGroups')
  assert.ok(limitIdx > 0 && limitIdx < groupsIdx, '限流应在分组之前，每请求只计一次')
  // 限流调用不得出现在建帖循环内
  const txIdx = src.indexOf('db.transaction(')
  const lastLimit = src.lastIndexOf('checkDistributedRateLimit(')
  assert.ok(lastLimit < txIdx, '建帖事务内不得再触发限流')
})

test('图片归属与格式校验按整批一次完成，不随组数放大', () => {
  const ownedIdx = src.indexOf('const owned = await db')
  const groupsIdx = src.indexOf('const groups = splitImageGroups')
  assert.ok(ownedIdx > 0 && groupsIdx > 0)
  assert.match(src, /inArray\(mediaAssets\.id, imageIds\)/, '整批一次查询归属')
  assert.match(src, /eq\(mediaAssets\.uploadedBy, user\.id\)/, '严格校验上传者为当前用户')
  assert.match(src, /owned\.length !== imageIds\.length/, '数量不符即拒绝')
})

test('批次返回结构包含实际发帖数与批量标记', () => {
  for (const key of ['ids:', 'count,', 'batched:', 'status,', 'message']) {
    assert.ok(src.includes(key), `返回结构应包含 ${key}`)
  }
  assert.match(src, /batched: count > 1/)
})

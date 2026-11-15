import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 社区「发稿员（CONTRIBUTOR）豁免频率限流」回归守卫。
 *
 * 背景：多图批量发帖改造中，发帖端点被整体重写为「单请求 / 单事务 / 每 9 张一组」，
 * 传图端点引入 BATCH_DAILY_LIMIT（批量模式每日累计上限）。这两处最容易在后续重构、
 * 合并冲突或 AI 审查里把豁免判断弄丢、挪到限流之后，或让「每组一帖」误变成「每组一次限流」。
 *
 * 既有 contributor.test.ts 覆盖 isCommunityRateLimitExempt 纯函数语义（谁该豁免）；
 * 本文件补上端点到限流的链路（是否真的跳过、限流是否整批只计一次），二者互补。
 * 全部为静态源码断言，不连 DB、不依赖运行时环境。
 */
const repoRoot = process.cwd()
const read = (relative: string) => readFileSync(join(repoRoot, relative), 'utf-8')

const EXEMPT_GATE = 'if (!isCommunityRateLimitExempt(user))'
const POST_ENDPOINT = 'server/api/community/posts/index.post.ts'
const COMMENT_ENDPOINT = 'server/api/community/posts/[id]/comments.post.ts'
const MEDIA_ENDPOINT = 'server/api/community/media.post.ts'

/** 截取 gate 之后第一个 { ... } 的完整块内容（模板字符串 ${} 成对出现，不影响配对） */
function gateBlock(src: string): string | null {
  const start = src.indexOf(EXEMPT_GATE)
  if (start < 0) return null
  const open = src.indexOf('{', start + EXEMPT_GATE.length)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

const count = (src: string, needle: string) => src.split(needle).length - 1

/** 端点必须复用 community.ts 的统一判定，不能就地硬编码角色字符串 */
function assertUsesSharedExemptHelper(src: string, path: string) {
  const match = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]*utils\/community['"]/)
  assert.ok(
    match?.[1].includes('isCommunityRateLimitExempt'),
    `${path} 应从 community.ts 导入统一豁免判定`
  )
}

// 发帖 / 评论：分钟 + 日两次 checkDistributedRateLimit，都必须落在豁免块内
for (const ep of [
  { label: '发帖（含批量）', path: POST_ENDPOINT },
  { label: '评论', path: COMMENT_ENDPOINT }
]) {
  test(`${ep.label}：所有频率限流都在发稿员豁免分支内，块外无遗漏`, () => {
    const src = read(ep.path)
    const block = gateBlock(src)
    assert.ok(block, `${ep.path} 必须保留 ${EXEMPT_GATE} 守卫`)
    assertUsesSharedExemptHelper(src, ep.path)

    const total = count(src, 'checkDistributedRateLimit(')
    const inside = count(block!, 'checkDistributedRateLimit(')
    assert.ok(total >= 1, `${ep.label}端点应存在限流调用`)
    assert.equal(total, inside, `${ep.label}端点存在豁免块外的限流调用（发稿员会被误限流）`)
    assert.ok(count(block!, '429') >= 1, '限流块内应包含 429 拒绝')
  })
}

test('传图：每日张数限流在发稿员豁免分支内，且额度与批量开关解耦', () => {
  const src = read(MEDIA_ENDPOINT)
  const block = gateBlock(src)
  assert.ok(block, `${MEDIA_ENDPOINT} 必须保留 ${EXEMPT_GATE} 守卫`)
  assertUsesSharedExemptHelper(src, MEDIA_ENDPOINT)

  assert.ok(block!.includes('COMMUNITY_MEDIA_DAILY_LIMIT'), '429 拒绝应在豁免块内')
  assert.ok(block!.includes('DAILY_LIMIT'), '限流应使用统一常量')
  // 开关只控制拆帖，上传额度不得随开关变化
  assert.ok(
    !src.includes('allowMultiImageBatch'),
    '媒体上传限流不应引用多图批量开关（开关只控制拆帖）'
  )
  // 防「常量已删除但仍被引用」导致运行时 ReferenceError
  for (const name of ['BATCH_DAILY_LIMIT', 'dailyLimit']) {
    assert.ok(!src.includes(name), `${MEDIA_ENDPOINT} 不应残留已删除的标识符 ${name}`)
  }
  assert.equal(
    count(src, 'COMMUNITY_MEDIA_DAILY_LIMIT'),
    count(block!, 'COMMUNITY_MEDIA_DAILY_LIMIT'),
    '不应存在豁免块外的张数限流'
  )
  assert.equal(count(src, '429'), count(block!, '429'), '不应存在豁免块外的 429 限流拒绝')
})

test('批量发帖：限流按整批一次计，不随分组数放大', () => {
  const src = read(POST_ENDPOINT)
  const firstLimit = src.indexOf('checkDistributedRateLimit(')
  const lastLimit = src.lastIndexOf('checkDistributedRateLimit(')
  const split = src.indexOf('splitImageGroups(')
  const insertLoop = src.indexOf('for (let index = 0; index < groups.length')
  assert.ok(firstLimit >= 0 && split > firstLimit, '限流应在分组之前，每请求只计一次')
  assert.ok(lastLimit < split, '所有限流调用都应在分组之前，不随组数重复')
  assert.ok(insertLoop > lastLimit, '建帖事务循环不应包含限流')
})

test('统一豁免判定只认 CONTRIBUTOR，不扩权到其他角色', () => {
  const src = read('server/utils/community.ts')
  const start = src.indexOf('export function isCommunityRateLimitExempt')
  assert.ok(start >= 0, 'community.ts 应导出 isCommunityRateLimitExempt')
  const body = src.slice(start, src.indexOf('\n}', start))
  assert.match(body, /===\s*'CONTRIBUTOR'/, '应仅判断 CONTRIBUTOR 角色')
  assert.ok(!/ADMIN|REVIEWER|BROADCASTER|SONG_ADMIN/.test(body), '不应把其他角色纳入豁免')
})

test('发稿员豁免仅限流、不提权：角色等级仍为普通用户层级 0', () => {
  const src = read('server/config/constants.ts')
  assert.match(src, /CONTRIBUTOR:\s*0/, '发稿员角色等级应保持 0（普通用户层级）')
})

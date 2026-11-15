import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const endpoint = () => read('server/api/admin/community/archive/purge.post.ts')
const utils = () => read('server/utils/communityArchive.ts')
const pure = () => read('server/utils/communityArchivePurge.ts')
const catalog = () => read('server/utils/adminAuditCatalog.ts')
const component = () => read('app/components/Admin/CommunityArchive.vue')

test('端点：仅管理员可调用，且先做请求归一化再删除', () => {
  const src = endpoint()
  assert.match(src, /requireCommunityAdmin\(event\)/, '必须与归档列表/恢复同权限')
  assert.match(src, /normalizeArchivePurgeRequest\(body\)/, '必须走纯函数归一化')
  assert.match(src, /if \(!parsed\.ok\)/, '非法请求必须拦截')
  assert.match(src, /createApiError\(400, parsed\.code/, '非法请求返回 400 与统一错误码')
  assert.match(src, /purgeArchivedCommunityContent\(scope\)/, '删除统一由归档工具执行')
  assert.ok(!src.includes('db.delete('), '端点不应直接操作数据库')
})

test('端点：写带动作、范围与结果数量的审计记录', () => {
  const src = endpoint()
  assert.match(src, /writeAdminAudit\(event, \{/)
  assert.match(src, /action: 'COMMUNITY_ARCHIVE_PURGE'/)
  assert.match(src, /result\.posts/)
  assert.match(src, /result\.remaining/)
})

test('工具：只删 deletedAt 非空的归档记录，删除时重新校验防并发误删', () => {
  const src = utils()
  assert.match(src, /export async function purgeArchivedCommunityContent/, '导出可复用删除函数')
  assert.match(src, /isNotNull\(communityPosts\.deletedAt\)/)
  assert.match(src, /isNotNull\(communityComments\.deletedAt\)/)
  // 删除语句必须带 deletedAt 条件，而不是仅凭候选 id
  assert.match(src, /and\(inArray\(communityPosts\.id, ids\), isNotNull\(communityPosts\.deletedAt\)\)/)
  assert.match(src, /and\(inArray\(communityComments\.id, ids\), isNotNull\(communityComments\.deletedAt\)\)/)
  assert.match(src, /\.returning\(\{ id:/, '用 returning 统计实际删除数')
})

test('工具：分页有界、复用媒体清理、返回剩余数量', () => {
  const src = utils()
  assert.match(src, /PURGE_BATCH_SIZE/)
  assert.match(src, /PURGE_MAX_TOTAL/)
  assert.match(src, /purgePostMedia\(mediaIds\)/, '帖子图片复用既有回收口径')
  assert.match(src, /communityPostImages/, '删除前收集图片 mediaId')
  assert.match(src, /remaining: await countArchived\(scope\)/)
})

test('纯函数：all / ids 互斥且空 ids 不得触发全站删除', () => {
  const src = pure()
  assert.match(src, /if \(all && ids\.length\)/)
  assert.match(src, /if \(!all && !ids\.length\)/)
  assert.match(src, /ids\.length > PURGE_MAX_IDS/)
  assert.match(src, /boardId: all \? boardId : undefined/, 'ids 模式忽略板块条件')
})

test('审计目录：动作常量与路径映射齐全', () => {
  const src = catalog()
  assert.match(src, /COMMUNITY_ARCHIVE_PURGE: '彻底删除归档内容'/)
  assert.match(src, /archive\/purge' && m === 'POST'/)
})

test('组件：范围清空与单条删除入口齐全，且仅管理员可见', () => {
  const src = component()
  assert.match(src, /:show-input="true"/, '范围清空必须输入确认文字')
  assert.match(src, /@confirm="runPurgeRange"/)
  assert.match(src, /@confirm="runPurgeSingle"/)
  assert.match(src, /v-if="isCommunityAdmin"/)
  assert.equal((src.match(/askPurgeSingle\('/g) || []).length, 2, '帖子与评论各一个单条删除按钮')
  assert.match(src, /toUpperCase\(\) !== expected\.toUpperCase\(\)/, '确认文字大小写不敏感比较')
  assert.match(src, /body: \{ type: type\.value, all: true, boardId: boardId\.value \|\| undefined \}/, '范围清空按当前筛选提交')
  assert.match(src, /ids: \[target\.id\]/, '单条删除只提交该记录 id')
  assert.match(src, /await load\(\)/, '删除后刷新列表与统计')
})

test('双语词典：删除相关键与错误码成对出现', () => {
  const zh = read('app/utils/locale/zh-CN.ts')
  const en = read('app/utils/locale/en-US.ts')
  const keys = [
    'purge:', 'purgeRange:', 'purgeRangeTitle:', 'purgeRangeMsg:', 'purgeConfirmWord:',
    'purgeWrongWord:', 'purgePostTitle:', 'purgePostMsg:', 'purgeCommentTitle:',
    'purgeCommentMsg:', 'purgeSuccess:', 'purgeFailed:', 'purgeEmpty:'
  ]
  for (const key of keys) {
    assert.ok(zh.includes(key), `zh-CN 缺少 ${key}`)
    assert.ok(en.includes(key), `en-US 缺少 ${key}`)
  }
  assert.ok(zh.includes('COMMUNITY_ARCHIVE_PURGE_INVALID:'))
  assert.ok(en.includes('COMMUNITY_ARCHIVE_PURGE_INVALID:'))
})

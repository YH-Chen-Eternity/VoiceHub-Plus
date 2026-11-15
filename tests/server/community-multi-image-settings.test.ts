import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 多图批量开关的配置层闭环：schema / 迁移 / 公开配置 / 后台读写 / UI。
 * 开关语义仅限「是否允许超过单帖上限并自动拆帖」，不与其它配置联动。
 */
const repoRoot = process.cwd()
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf-8')

test('schema 新增布尔列，默认关闭', () => {
  const schema = read('app/drizzle/schema.ts')
  assert.match(
    schema,
    /allowMultiImageBatch: boolean\('allowMultiImageBatch'\)\.default\(false\)\.notNull\(\)/
  )
})

test('迁移 SQL 只加一列，且 journal / snapshot 同步', () => {
  const sql = read('app/drizzle/migrations/20261115003401_community-multi-image-batch.sql')
  assert.match(sql, /ALTER TABLE "CommunitySettings" ADD COLUMN "allowMultiImageBatch" boolean DEFAULT false NOT NULL/)
  assert.equal(sql.trim().split(';').filter(Boolean).length, 1, '迁移不应夹带其它变更')

  const journal = JSON.parse(read('app/drizzle/migrations/meta/_journal.json'))
  const entry = (journal.entries || []).find(
    (item: { tag?: string }) => item.tag === '20261115003401_community-multi-image-batch'
  )
  assert.ok(entry, 'journal 应登记该迁移')
  const snapshot = JSON.parse(read('app/drizzle/migrations/meta/20261115003401_snapshot.json'))
  const table = snapshot?.tables?.['public.CommunitySettings'] || snapshot?.tables?.CommunitySettings
  assert.ok(table?.columns?.allowMultiImageBatch, 'snapshot 应包含新列')
})

test('公开配置下发开关，且绝不下发审核密钥', () => {
  const community = read('server/utils/community.ts')
  assert.match(community, /allowMultiImageBatch: row\.allowMultiImageBatch/)
  const fnBody = community.slice(
    community.indexOf('export function toPublicCommunitySettings'),
    community.indexOf('export async function requireCommunityEnabled')
  )
  assert.ok(!fnBody.includes('aliyunAccessKeySecret:'), '公开配置不得包含密钥')
  assert.match(fnBody, /moderationConfigured:/, '应只下发是否已配置的布尔值')
})

test('后台读取 / 写入 / 回显三处均包含新字段', () => {
  const get = read('server/api/admin/community/settings.get.ts')
  const put = read('server/api/admin/community/settings.put.ts')
  assert.match(get, /allowMultiImageBatch: settings\.allowMultiImageBatch/)
  assert.match(put, /if \(typeof body\?\.allowMultiImageBatch === 'boolean'\) patch\.allowMultiImageBatch = body\.allowMultiImageBatch/)
  assert.match(put, /allowMultiImageBatch: updated\?\.allowMultiImageBatch/)
  // 只做简单赋值，不与 allowImages 做隐式联动（避免开关语义外溢）
  const patchLine = put.slice(
    put.indexOf("if (typeof body?.allowMultiImageBatch === 'boolean')"),
    put.indexOf('if (Object.prototype.hasOwnProperty.call(body', put.indexOf("if (typeof body?.allowMultiImageBatch === 'boolean')"))
  )
  assert.ok(!patchLine.includes('allowImages'), '批量开关写入不应夹带 allowImages 联动')
})

test('管理后台 UI 有独立 switch，且依赖「允许图片」时禁用', () => {
  const ui = read('app/components/Admin/CommunitySettings.vue')
  assert.match(ui, /form\.allowMultiImageBatch/, '应有独立开关')
  assert.match(ui, /:aria-checked="form\.allowMultiImageBatch"/)
  assert.match(ui, /:disabled="!form\.allowImages"/, '图片关闭时开关应禁用')
  assert.match(ui, /toggleAllowImages/, '关闭图片时同步关掉批量开关')
  const form = ui.slice(ui.indexOf('const form = reactive({'), ui.indexOf('const secrets'))
  assert.match(form, /allowMultiImageBatch: false/, '默认值应为关闭')
})

test('双语词典：开关文案与批量提示 zh/en 键一一对应', async () => {
  const zh = (await import('../../app/utils/locale/zh-CN.ts')).community as Record<string, any>
  const en = (await import('../../app/utils/locale/en-US.ts')).community as Record<string, any>
  const keys = [
    'imageHintBatch', 'imageOnlyHint', 'batchPostCount', 'batchPublished',
    'imageContentMismatch', 'imageUploadProgress', 'imageUploadRetry',
    'imageUploadPartialFailed', 'imageUploadAborted',
    'draftRestored', 'draftDiscard', 'draftDiscardConfirm', 'draftSaveFailed'
  ]
  for (const key of keys) {
    assert.ok(zh[key], `zh-CN 缺少 ${key}`)
    assert.equal(typeof zh[key], typeof en[key], `${key} 中英类型应一致`)
    assert.ok(en[key], `en-US 缺少 ${key}`)
  }
  for (const key of ['allowMultiImageBatchLabel', 'allowMultiImageBatchHint']) {
    assert.ok(typeof zh.admin?.[key] === 'string' && zh.admin[key], `zh admin 缺少 ${key}`)
    assert.ok(typeof en.admin?.[key] === 'string' && en.admin[key], `en admin 缺少 ${key}`)
  }
})

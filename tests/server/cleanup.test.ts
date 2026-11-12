import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 契约 §7 / §9：日志清理 dryRun 契约静态守卫测试。
 *
 * server/api/ops-board/logs/cleanup.post.ts 依赖 DB 且需 requireSuperAdmin，CI 不起服务，
 * 故读取源码文本断言：dryRun 分支、days clamp（1~3650）、审计 writeAdminAuditRecord、
 * requireSuperAdmin + no-store，以及「实删被 dryRun 门控」→ dryRun 不删除。
 * 这是静态守卫测试（防止后续改动把预览 / 审计 / clamp 删掉回归），并非真实删除行为测试；
 * 文件未创建时 t.skip，保证 pnpm test 不崩。
 */
const FILE = fileURLToPath(new URL('../../server/api/ops-board/logs/cleanup.post.ts', import.meta.url))
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
let code = ''
try { code = stripComments(readFileSync(FILE, 'utf8')) } catch { code = '' }

function ready(t: any): boolean {
  if (!code) {
    t.skip('依赖模块尚未就绪：cleanup.post.ts 尚未创建（Agent G 负责）')
    return false
  }
  return true
}

test('鉴权与缓存头：requireSuperAdmin + no-store + defineEventHandler', (t) => {
  if (!ready(t)) return
  assert.match(code, /requireSuperAdmin\s*\(/, '写操作应 requireSuperAdmin(event)')
  assert.match(code, /(no-store|setOpsBoardNoStore)/, '应设置 Cache-Control: no-store（可直接写或调用统一封装）')
  assert.match(code, /defineEventHandler/, '应使用 defineEventHandler')
})

test('dryRun 契约：存在预览分支且手动写审计记录', (t) => {
  if (!ready(t)) return
  assert.match(code, /\bdryRun\b/, '应读取 body.dryRun')
  assert.ok((code.match(/\bdryRun\b/g) || []).length >= 2, 'dryRun 应同时出现在预览分支与实删门控')
  assert.match(code, /(writeAdminAuditRecord|writeAdminAudit)/, '看板写操作需在端点内手动写审计记录（§10，writeAdminAudit 内部转调 Record）')
})

test('days 边界 clamp（1~3650）与三类日志表', (t) => {
  if (!ready(t)) return
  assert.match(code, /\bdays\b/, '应读取 body.days')
  assert.ok(/3650|Math\.min|Math\.max|clamp/i.test(code), 'days 应 clamp 到 1~3650 区间')
  assert.match(code, /AttackLog|LoginAttempt|AdminAuditLog/, '应覆盖三类日志表的清理')
})

test('dryRun 不删除：实删路径必须受 dryRun 门控', (t) => {
  if (!ready(t)) return
  const hasDelete = /\.delete\s*\(|db\.delete|\bDELETE\b|deleteMany/i.test(code)
  assert.ok(hasDelete, '端点应包含实际删除调用（否则 dryRun 分支无意义）')
  assert.ok(
    /if\s*\(\s*!?dryRun\s*\)/.test(code) ||
      /dryRun\s*\?/.test(code) ||
      /dryRun[\s\S]{0,400}\b(return|预览|preview)\b/.test(code),
    '删除调用应位于 !dryRun 分支；dryRun 时仅返回预览不落删'
  )
})

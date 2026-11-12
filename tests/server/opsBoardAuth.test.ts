import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 契约 §7 / §9：/api/ops-board/* 端点鉴权静态契约测试。
 *
 * 端点由 Agent G 并行实现，依赖 DB / Redis / 独立 PG / 云监控，CI 无法起服务做集成测试，
 * 故按仓库 policy 测试惯例读取端点源码断言：
 *  - 每个端点首行 requireAdmin(event)（对应 USER→403 / ADMIN→200 契约）；
 *  - 写操作（PUT/POST/DELETE）额外 requireSuperAdmin(event)；
 *  - 统一 setHeader no-store、defineEventHandler（§10）。
 * 目录尚未创建或无端点文件时 t.skip，保证 pnpm test 不崩。
 * 注意：这是静态契约守卫（防回归删鉴权/no-store），并非真实 HTTP 状态码测试。
 */
const ROOT = fileURLToPath(new URL('../../server/api/ops-board/', import.meta.url))

function collect(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...collect(full))
    else if (/\.(get|post|put|delete)\.ts$/.test(name)) out.push(full)
  }
  return out
}

let files: string[] = []
try { files = collect(ROOT) } catch { files = [] }
const short = (f: string) => f.slice(ROOT.length).replace(/\\/g, '/')

test('看板路由前缀独立于 /api/admin（避免 zz-admin-guard 白名单问题）', () => {
  assert.ok(ROOT.replace(/\\/g, '/').includes('/server/api/ops-board'))
  assert.ok(!ROOT.includes('/api/admin'))
})

test('ops-board GET 端点均 requireAdmin + no-store（USER 403 / ADMIN 200 契约）', (t) => {
  const gets = files.filter((f) => f.endsWith('.get.ts'))
  if (gets.length === 0) {
    t.skip('依赖模块尚未就绪：server/api/ops-board/ 尚无 GET 端点（Agent G 负责）')
    return
  }
  for (const f of gets) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /requireAdmin\s*\(/, `${short(f)} 首行应 requireAdmin(event)`)
    assert.match(src, /(no-store|setOpsBoardNoStore)/, `${short(f)} 应设置 Cache-Control: no-store（可直接写或调用统一封装）`)
    assert.match(src, /defineEventHandler/, `${short(f)} 应使用 defineEventHandler`)
  }
})

test('ops-board 写端点额外 requireSuperAdmin + no-store', (t) => {
  const writes = files.filter((f) => /\.(post|put|delete)\.ts$/.test(f))
  if (writes.length === 0) {
    t.skip('依赖模块尚未就绪：server/api/ops-board/ 尚无写端点')
    return
  }
  for (const f of writes) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /requireSuperAdmin\s*\(/, `${short(f)} 写操作应 requireSuperAdmin(event)`)
    assert.match(src, /(no-store|setOpsBoardNoStore)/, `${short(f)} 应设置 Cache-Control: no-store（可直接写或调用统一封装）`)
    assert.match(src, /defineEventHandler/, `${short(f)} 应使用 defineEventHandler`)
  }
})

test('no-store 契约链闭合：统一封装内部确实写入 Cache-Control', (t) => {
  const shared = fileURLToPath(new URL('../../server/api/ops-board/_shared.ts', import.meta.url))
  let src: string
  try { src = readFileSync(shared, 'utf8') } catch {
    t.skip('依赖模块尚未就绪：_shared.ts 尚未创建（Agent G 负责）')
    return
  }
  const block = src.match(/export function setOpsBoardNoStore[\s\S]{0,240}/)
  assert.ok(block, '_shared.ts 应导出 setOpsBoardNoStore')
  assert.match(
    block[0],
    /setHeader\s*\(\s*event\s*,\s*['"]Cache-Control['"]\s*,\s*['"]no-store['"]\s*\)/,
    '封装内必须真正写入 Cache-Control: no-store，避免端点只调用空壳函数'
  )
})

test('契约要求的写端点齐备：settings.put.ts 与 logs/cleanup.post.ts', (t) => {
  if (files.length === 0) {
    t.skip('依赖模块尚未就绪：server/api/ops-board/ 尚未创建')
    return
  }
  const paths = files.map(short)
  assert.ok(paths.includes('settings.put.ts'), '应存在 settings.put.ts（写 opsBoardSettings）')
  assert.ok(paths.includes('logs/cleanup.post.ts'), '应存在 logs/cleanup.post.ts（日志清理）')
})

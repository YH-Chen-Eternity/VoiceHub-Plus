import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

/**
 * 回归：requireCommunityAdmin 必须返回当前用户。
 *
 * 事故背景（2026-11-17）：该函数曾显式声明为 void（只鉴权、不返回用户），
 * 但管理后台「恢复归档」路由写成
 *   const user = requireCommunityAdmin(event)
 *   ... actor: user
 * 于是 actor 恒为 undefined，深层 getReviewableBoardIds 取 user.id 抛
 * TypeError: Cannot read properties of undefined (reading 'id')，
 * 导致所有管理员恢复归档一律 500“服务暂时不可用”。
 *
 * 本测试运行真实模块（stub 掉数据库等重依赖），锁定两条契约：
 * 1. requireCommunityAdmin 返回 user，且是会话里同一个对象；
 * 2. getReviewableBoardIds 对缺失操作者 fail-closed 抛 401，而不是 TypeError 500，
 *    也绝不能把它当作“管理员无限制”放行。
 */

const source = fileURLToPath(new URL('../../server/utils/community.ts', import.meta.url))

// requireCommunityAdmin / getReviewableBoardIds 不触库，stub 重依赖只为能打包加载
const stubs: Record<string, string> = {
  '~/drizzle/db': 'export const db = {}',
  '~/drizzle/schema': `
    export const communityBoardReviewers = {}
    export const communityBoards = {}
    export const communityProfiles = {}
    export const communityViolations = {}
    export const communitySettings = {}
    export const communityTitles = {}
    export const users = {}
  `,
  'drizzle-orm': `
    export const and = (...args) => args
    export const eq = () => ({})
    export const gte = () => ({})
    export const sql = () => ({})
  `,
  './apiError': `
    export function createApiError(statusCode, code, message) {
      const e = new Error(message)
      e.statusCode = statusCode
      e.statusMessage = code
      e.data = { code }
      return e
    }
  `,
  './rolePagesSettings': 'export const getRolePagesCached = async () => ({})',
  '~~/types/rolePages': `
    export const CONFIGURABLE_ROLES = []
    export const resolveEffectivePages = () => null
  `
}

const compiled = await build({
  entryPoints: [source],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'stub-community-deps',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(~\/drizzle\/(db|schema)|drizzle-orm|\.\/apiError|\.\/rolePagesSettings|~~\/types\/rolePages)$/
          },
          (args) => ({ path: args.path, namespace: 'stub' })
        )
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents: stubs[args.path] ?? 'export default {}',
          loader: 'ts'
        }))
      }
    }
  ]
})

const mod = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
)

test('requireCommunityAdmin 返回管理员用户本身（actor 不能是 undefined）', () => {
  const admin = { id: 7, name: 'admin', role: 'ADMIN' }
  const returned = mod.requireCommunityAdmin({ context: { user: admin } })
  assert.equal(returned, admin, '必须原样返回会话用户对象')
  assert.equal(returned.id, 7)
})

test('requireCommunityAdmin 对超管同样返回用户', () => {
  const su = { id: 1, name: 'root', role: 'SUPER_ADMIN' }
  assert.equal(mod.requireCommunityAdmin({ context: { user: su } }).id, 1)
})

test('requireCommunityAdmin 拒绝非管理员（403）', () => {
  assert.throws(
    () => mod.requireCommunityAdmin({ context: { user: { id: 9, role: 'REVIEWER' } } }),
    (err: any) => err.statusCode === 403
  )
})

test('requireCommunityAdmin 拒绝未登录（401）', () => {
  assert.throws(
    () => mod.requireCommunityAdmin({ context: {} }),
    (err: any) => err.statusCode === 401
  )
})

test('getReviewableBoardIds 对管理员返回 null（无板块限制）', async () => {
  assert.equal(await mod.getReviewableBoardIds({ id: 7, role: 'ADMIN' }), null)
})

test('getReviewableBoardIds 对缺失操作者 fail-closed 401，而不是 TypeError 500', async () => {
  await assert.rejects(
    () => mod.getReviewableBoardIds(undefined),
    (err: any) => err.statusCode === 401
  )
})

test('restore 路由使用 requireCommunityAdmin 的返回值作为 actor（契约一致）', () => {
  const route = readFileSync(
    join(
      process.cwd(),
      'server/api/admin/community/archive/[type]/[id]/restore.post.ts'
    ),
    'utf-8'
  )
  assert.match(
    route,
    /const\s+user\s*=\s*requireCommunityAdmin\(event\)/,
    'restore 路由依赖 requireCommunityAdmin 返回用户'
  )
  assert.match(route, /actor:\s*user\b/, '必须把该用户作为 actor 传入业务函数')
})

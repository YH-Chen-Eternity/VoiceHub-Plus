import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 角色权限（rolePages）端点级强制契约：
 * - types/rolePages.ts 导出 ADMIN_PAGE_ROUTES（页面 id → /api/admin/* 路由模式）；
 * - zz-admin-guard.ts 在既有角色判定之后按映射检查生效页面，
 *   SUPER_ADMIN 直通、未映射路径不强制、命中页面全部未授权 → 403。
 * 静态契约守卫（防回归删除端点级强制），判定语义由 rolePages 逻辑单测覆盖。
 */
const GUARD = fileURLToPath(new URL('../../server/middleware/zz-admin-guard.ts', import.meta.url))
const ROLE_PAGES = fileURLToPath(new URL('../../types/rolePages.ts', import.meta.url))

test('zz-admin-guard 实施角色权限端点级强制', () => {
  const src = readFileSync(GUARD, 'utf8')
  assert.match(src, /ADMIN_PAGE_ROUTES/, '应引用页面路由映射表')
  assert.match(src, /resolveEffectivePages/, '应按生效页面判定')
  assert.match(src, /getRolePagesCached/, 'rolePages 应走缓存读取（避免每请求查库）')
  assert.match(src, /SUPER_ADMIN/, 'SUPER_ADMIN 应直通')
  assert.match(src, /AUTH_PAGE_FORBIDDEN/, '端点级拒绝应有独立错误码')
  // 判定必须在审计写入之前（被拒请求不产生审计记录）
  const guard = src.indexOf('const hitPages = ADMIN_PAGE_ROUTES')
  const audit = src.indexOf('await describeAdminAction(')
  assert.ok(guard > -1 && audit > -1 && guard < audit, '端点级检查应位于审计动作描述之前')
})

test('ADMIN_PAGE_ROUTES：页面 id 全部合法且无重复条目', async () => {
  const mod = await import('../../types/rolePages.ts')
  const ids = mod.ADMIN_PAGE_ROUTES.map(([p]: [string]) => p)
  const dup = ids.filter((x: string, i: number) => ids.indexOf(x) !== i)
  assert.deepEqual(dup, [], '页面 id 不应重复')
  const bad = ids.filter((p: string) => !(mod.CONFIGURABLE_PAGE_IDS as readonly string[]).includes(p))
  assert.deepEqual(bad, [], '映射页面 id 必须都在 CONFIGURABLE_PAGE_IDS 白名单内')
})

test('既有角色行为不被端点级映射破坏（关键场景判定）', async () => {
  const mod = await import('../../types/rolePages.ts')
  const hit = (path: string) =>
    mod.ADMIN_PAGE_ROUTES.filter(([, ps]: [string, RegExp[]]) => ps.some((p) => p.test(path.toLowerCase()))).map(([p]: [string]) => p)
  const can = (role: string, path: string) => {
    const allowed = new Set(mod.resolveEffectivePages(role, null) || [])
    const pages = hit(path)
    return pages.length === 0 || pages.some((p: string) => allowed.has(p))
  }
  // 放歌员既有能力：读播放时段/学期、标记已播放（映射归 schedule）
  assert.ok(can('BROADCASTER', '/api/admin/play-times'), 'BROADCASTER 读播放时段应放行')
  assert.ok(can('BROADCASTER', '/api/admin/semesters'), 'BROADCASTER 读学期应放行')
  assert.ok(can('BROADCASTER', '/api/admin/songs/mark-played'), 'BROADCASTER 标记已播放应放行')
  // 歌曲管理员：stats 归 overview（默认含），users 不在其 pattern（guard 先拒）
  assert.ok(can('SONG_ADMIN', '/api/admin/stats'), 'SONG_ADMIN 读统计应放行')
  assert.ok(can('SONG_ADMIN', '/api/admin/songs'), 'SONG_ADMIN 歌曲管理应放行')
  // 审帖员：社区审核放行，社区用户管理拒绝（接口内部原本也拒）
  assert.ok(can('REVIEWER', '/api/admin/community/review/batch'), 'REVIEWER 审核操作应放行')
  assert.ok(!can('REVIEWER', '/api/admin/community/users'), 'REVIEWER 社区用户管理应拒绝')
  // 核心诉求：超管取消 ADMIN 的 users 页后，users 端点同步 403
  const stripped = mod.DEFAULT_ROLE_PAGES.ADMIN.filter((p: string) => p !== 'users')
  const allowed = new Set(mod.resolveEffectivePages('ADMIN', { ADMIN: stripped }) || [])
  const pages = hit('/api/admin/users')
  assert.ok(!pages.some((p: string) => allowed.has(p)), '取消 users 页后 ADMIN 应无法访问 users 端点')
})

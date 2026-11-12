/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 角色后台页面权限契约测试：
 *  - types/rolePages.ts 共享定义的规范化与生效解析
 *  - role-pages GET/PUT 端点仅超管（requireSuperAdmin）+ no-store
 *  - verify/login 下发 effectivePages 的字段存在性
 *  - 社区用户管理动作的越级保护（管理员不得操作超管）
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = join(fileURLToPath(import.meta.url), '../../..')
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8')

describe('types/rolePages.ts 共享定义', () => {
  test('sanitizeRolePages 剔除非法角色与非法页面 id，并去重', async () => {
    const mod = await import('../../types/rolePages.ts')
    const out = mod.sanitizeRolePages({
      ADMIN: ['overview', 'database', 'overview', 'role-permissions', 42],
      HACKER: ['overview'],
      SONG_ADMIN: 'not-array'
    })
    assert.deepEqual(out, { ADMIN: ['overview'] }, '仅保留 ADMIN 的合法唯一页面 id')
  })

  test('resolveEffectivePages：配置键存在用配置值，否则回退内置默认；不可配置角色返回 null', async () => {
    const mod = await import('../../types/rolePages.ts')
    // 已定格到当前版本的快照：原样返回
    assert.deepEqual(
      mod.resolveEffectivePages('ADMIN', { __version: mod.ROLE_PAGES_SCHEMA_VERSION, ADMIN: ['overview'] }),
      ['overview']
    )
    assert.deepEqual(
      mod.resolveEffectivePages('ADMIN', {}),
      mod.DEFAULT_ROLE_PAGES.ADMIN,
      '无配置键回退默认'
    )
    assert.deepEqual(mod.resolveEffectivePages('ADMIN', null), mod.DEFAULT_ROLE_PAGES.ADMIN)
    assert.equal(mod.resolveEffectivePages('SUPER_ADMIN', { ADMIN: ['overview'] }), null, '超管不参与配置')
    assert.equal(mod.resolveEffectivePages('USER', null), null)
  })

  test('旧版本快照增量补齐本版本新增页面（运维看板），显式取消的其他页面不补', async () => {
    const mod = await import('../../types/rolePages.ts')
    // 生产实际形态：上线看板前保存的 ADMIN 快照，没有 ops-board / site-config
    const legacy = { ADMIN: ['overview', 'users'] }
    const adminPages = mod.resolveEffectivePages('ADMIN', legacy)
    assert.ok(adminPages?.includes('ops-board'), '旧快照应自动补入 ops-board')
    assert.ok(!adminPages?.includes('site-config'), '显式未开通的页面不得补回')
    assert.ok(!adminPages?.includes('database'), '超管专属页仍被过滤')

    // 默认不含看板的角色不补
    const reviewerPages = mod.resolveEffectivePages('REVIEWER', { REVIEWER: ['community-review'] })
    assert.ok(!reviewerPages?.includes('ops-board'), 'REVIEWER 默认无 ops-board，不应补齐')

    // 已定格到当前版本：不再自动补，尊重超管的取消勾选
    const stamped = mod.resolveEffectivePages('ADMIN', { __version: mod.ROLE_PAGES_SCHEMA_VERSION, ADMIN: ['overview'] })
    assert.deepEqual(stamped, ['overview'], '版本已定格后取消勾选保持取消')
  })

  test('normalizeRolePagesConfig：配置页回显与运行时生效值同口径', async () => {
    const mod = await import('../../types/rolePages.ts')
    const legacy = { ADMIN: ['overview'], REVIEWER: ['community-review'] }
    const view = mod.normalizeRolePagesConfig(legacy)
    assert.ok(Array.isArray(view?.ADMIN) && (view!.ADMIN as string[]).includes('ops-board'), '回显视图应含补齐后的 ops-board')
    assert.deepEqual(view?.REVIEWER, ['community-review'], '默认不含看板的角色回显不变')
    assert.equal(view?.__version, undefined, '不写库、不应擅自加版本号')
    assert.equal(mod.normalizeRolePagesConfig(null), null)
    // GET 端点使用该视图，防止「服务端放行、配置页显示未勾选」
    const src = read('server/api/admin/role-pages.get.ts')
    assert.match(src, /normalizeRolePagesConfig/, 'GET 应返回规范化视图')
  })

  test('内置默认不含超管专属页面（database / role-permissions）', async () => {
    const mod = await import('../../types/rolePages.ts')
    for (const [role, pages] of Object.entries(mod.DEFAULT_ROLE_PAGES)) {
      assert.ok(!pages.includes('database'), `${role} 默认不应含 database`)
      assert.ok(!pages.includes('role-permissions'), `${role} 默认不应含 role-permissions`)
    }
  })

  test('resolveEffectivePages 纵深防御：配置值中的超管专属页面被过滤', async () => {
    const mod = await import('../../types/rolePages.ts')
    const out = mod.resolveEffectivePages('ADMIN', {
      __version: mod.ROLE_PAGES_SCHEMA_VERSION,
      ADMIN: ['overview', 'database', 'role-permissions', 'users']
    })
    assert.deepEqual(out, ['overview', 'users'], '即便配置被直改库注入超管页，生效值也必须剔除')
  })
})

describe('role-pages 端点契约', () => {
  test('GET/PUT 均要求超管并设置 no-store', () => {
    for (const f of ['server/api/admin/role-pages.get.ts', 'server/api/admin/role-pages.put.ts']) {
      const src = read(f)
      assert.match(src, /requireSuperAdmin\s*\(/, `${f} 应 requireSuperAdmin`)
      assert.match(src, /no-store/, `${f} 应设置 Cache-Control: no-store`)
    }
  })

  test('PUT 拒绝非法角色与非法页面 id（走 sanitize + 显式校验）', () => {
    const src = read('server/api/admin/role-pages.put.ts')
    assert.match(src, /ROLE_PAGES_INVALID_ROLE/, '应有不支持角色的错误码')
    assert.match(src, /ROLE_PAGES_INVALID_PAGES/, '应有非法页面列表的错误码')
    assert.match(src, /Array\.isArray\(value\)/, '角色值必须是数组的显式校验')
    assert.match(src, /invalidateRolePagesCache\(\)/, '保存后应失效 60s 进程内缓存，保证配置即时生效')
    assert.match(src, /ROLE_PAGES_UPDATE/, '应写管理审计日志')
    assert.match(src, /ROLE_PAGES_SCHEMA_VERSION/, '保存时应写入结构版本，避免新旧快照增量补齐反复生效')
  })

  test('verify 与 login 均下发生效页面（effectivePages）', () => {
    const verify = read('server/api/auth/verify.get.ts')
    const login = read('server/api/auth/login.post.ts')
    for (const [name, src] of [['verify', verify], ['login', login]] as const) {
      assert.match(src, /resolveEffectivePages/, `${name} 应调用 resolveEffectivePages`)
      assert.match(src, /effectivePages/, `${name} 响应应含 effectivePages`)
    }
  })
})

describe('防越权：社区用户管理动作', () => {
  test('action.post.ts 禁止管理员操作超级管理员', () => {
    const src = read('server/api/admin/community/users/[id]/action.post.ts')
    assert.match(src, /SUPER_ADMIN/, '应有目标角色越级保护')
    assert.match(src, /COMMUNITY_USER_PRIVILEGE_ESCALATION/, '应有越权错误码')
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync } from 'node:fs'
import { BOT_ROUTES } from '../../server/config/constants.ts'
import {
  canBindOAuthIdentity,
  isAllowedDuringPasswordChange,
  isPublicApiPath,
  shouldBlockDuringPasswordChange,
  shouldBypassPublicApiAuthentication
} from '../../server/utils/auth-route-policy.ts'

test('匿名用户可以访问公共接口', () => {
  assert.equal(isPublicApiPath('/api/songs/public', 'GET'), true)
  assert.equal(shouldBypassPublicApiAuthentication('/api/songs/public', 'GET', false), true)
})

test('OAuth 注册选项接口对匿名请求放行（binding-token 由接口自身校验）', () => {
  assert.equal(isPublicApiPath('/api/auth/oauth-register-options', 'GET'), true)
  assert.equal(isPublicApiPath('/api/auth/oauth-register-options', 'POST'), false)
})

test('携带登录态访问公共接口时必须经过认证检查', () => {
  assert.equal(shouldBypassPublicApiAuthentication('/api/songs/public', 'GET', true), false)
  assert.equal(shouldBypassPublicApiAuthentication('/api/site-config', 'GET', true), false)
  assert.equal(shouldBypassPublicApiAuthentication('/api/proxy/image', 'GET', true), false)
})

test('受保护接口不能绕过认证', () => {
  assert.equal(shouldBypassPublicApiAuthentication('/api/admin/users', 'GET', false), false)
  assert.equal(shouldBypassPublicApiAuthentication('/api/admin/users', 'GET', true), false)
})

test('强制改密期间只放行必要的认证接口', () => {
  assert.equal(isAllowedDuringPasswordChange('/api/auth/change-password', 'POST'), true)
  assert.equal(isAllowedDuringPasswordChange('/api/auth/set-initial-password', 'POST'), true)
  assert.equal(isAllowedDuringPasswordChange('/api/auth/logout', 'POST'), true)
  assert.equal(isAllowedDuringPasswordChange('/api/site-config', 'GET'), true)
  assert.equal(isAllowedDuringPasswordChange('/api/songs/public', 'GET'), false)
  assert.equal(isAllowedDuringPasswordChange('/api/admin/system-settings', 'GET'), false)
})

test('公共 API 路径匹配不会接受相似但未注册的路径', () => {
  assert.equal(isPublicApiPath('/api/auth/loginX', 'POST'), false)
  assert.equal(isPublicApiPath('/api/site-config.evil', 'GET'), false)
  assert.equal(isPublicApiPath('/api/site-config/extra', 'GET'), false)
  assert.equal(isPublicApiPath('/api/auth/webauthn/login/options', 'POST'), true)
  assert.equal(isAllowedDuringPasswordChange('/api/auth/change-passwordX', 'POST'), false)
})

test('公共 API 只放行已注册的 HTTP 方法', () => {
  assert.equal(isPublicApiPath('/api/auth/login', 'POST'), true)
  assert.equal(isPublicApiPath('/api/auth/login', 'GET'), false)
  assert.equal(isPublicApiPath('/api/site-config', 'GET'), true)
  assert.equal(isPublicApiPath('/api/site-config', 'POST'), false)
  assert.equal(isPublicApiPath('/api/music/state', 'POST'), true)
  assert.equal(isPublicApiPath('/api/music/state', 'GET'), false)
})

test('回声社区游客只读：GET 匿名放行，写操作与改密门控仍拦截', () => {
  // 游客可读的社区端点（端点内部自行限定只读范围）
  assert.equal(isPublicApiPath('/api/community/posts', 'GET'), true)
  assert.equal(isPublicApiPath('/api/community/posts/2', 'GET'), true)
  assert.equal(isPublicApiPath('/api/community/posts/2/comments', 'GET'), true)
  assert.equal(isPublicApiPath('/api/community/boards', 'GET'), true)
  assert.equal(isPublicApiPath('/api/community/songs', 'GET'), true)
  assert.equal(isPublicApiPath('/api/community/status', 'GET'), true)
  assert.equal(isPublicApiPath('/api/community/users/3', 'GET'), true)
  // 社区写操作不放行：游客写操作仍被中间件 401，登录用户写入走端点自校验
  assert.equal(isPublicApiPath('/api/community/posts', 'POST'), false)
  assert.equal(isPublicApiPath('/api/community/posts/2/comments', 'POST'), false)
  assert.equal(isPublicApiPath('/api/community/posts/2/like', 'POST'), false)
  // 需要登录的 GET 端点同样被匿名放行，但端点内 requireCommunityUser 会拒绝游客
  assert.equal(isPublicApiPath('/api/community/me', 'GET'), true)
  assert.equal(isPublicApiPath('/api/community/review/posts', 'GET'), true)
  // 强制改密状态不影响社区只读
  assert.equal(shouldBlockDuringPasswordChange('/api/community/posts', 'GET', true), false)
  // 匿名绕过仅在无 token 时生效，携带登录态仍走完整校验
  assert.equal(shouldBypassPublicApiAuthentication('/api/community/posts', 'GET', false), true)
  assert.equal(shouldBypassPublicApiAuthentication('/api/community/posts', 'GET', true), false)
})

test('公开图片 CDN 前缀：GET 匿名放行，其余方法不放行', () => {
  assert.equal(isPublicApiPath('/api/public/media/12', 'GET'), true)
  assert.equal(isPublicApiPath('/api/public/media/12', 'HEAD'), true)
  assert.equal(isPublicApiPath('/api/public/media/12', 'POST'), false)
  assert.equal(isPublicApiPath('/api/public/media/12', 'DELETE'), false)
  assert.equal(shouldBlockDuringPasswordChange('/api/public/media/12', 'GET', true), false)
  assert.equal(shouldBypassPublicApiAuthentication('/api/public/media/12', 'GET', false), true)
  assert.equal(shouldBypassPublicApiAuthentication('/api/public/media/12', 'GET', true), false)
})

test('强制改密门控放行公共 API，但阻止业务写入和 OAuth provider 路由', () => {
  assert.equal(shouldBlockDuringPasswordChange('/api/site-config', 'GET', true), false)
  assert.equal(shouldBlockDuringPasswordChange('/api/sys/time', 'GET', true), false)
  assert.equal(shouldBlockDuringPasswordChange('/api/music/state', 'POST', true), false)
  assert.equal(shouldBlockDuringPasswordChange('/api/auth/github', 'GET', true), true)
  assert.equal(shouldBlockDuringPasswordChange('/api/auth/github/callback', 'GET', true), true)
  assert.equal(shouldBlockDuringPasswordChange('/api/admin/users', 'GET', true), true)
  assert.equal(shouldBlockDuringPasswordChange('/api/admin/users', 'GET', false), false)
})

test('强制改密状态禁止持久化 OAuth 身份绑定', () => {
  assert.equal(canBindOAuthIdentity(true), false)
  assert.equal(canBindOAuthIdentity(false), true)
})

test('机器人免 Cookie 路由与实际端点文件逐项一致', () => {
  const dir = new URL('../../server/api/bot/voicehub/', import.meta.url)
  const expected = readdirSync(dir).filter(name => /\.(get|post)\.ts$/.test(name))
    .map(name => {
      const [, route, method] = name.match(/^(.+)\.(get|post)\.ts$/)!
      return `${method.toUpperCase()} /api/bot/voicehub/${route}`
    })
  assert.deepEqual([...BOT_ROUTES].sort(), expected.sort())
  assert.equal(BOT_ROUTES.has('POST /api/bot/voicehub/weekly-schedule'), false)
})

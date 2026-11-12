import { useAuth } from '~/composables/useAuth'

// 运维看板可见性：SUPER_ADMIN 恒可见；可配置角色（ADMIN/SONG_ADMIN/BROADCASTER/
// REVIEWER）按超管在「角色权限」页配置的生效页面（effectivePages 含 ops-board）
// 放行，未下发 effectivePages 的旧会话回退为仅 ADMIN 可见（与历史行为一致）。
// /api/ops-board/* 由服务端 requireOpsBoardViewer 同口径兜底。
// 注意：app/plugins/auth.server.ts 已停用，SSR 阶段 useState('user') 为空，
// 因此服务端不做重定向，交由客户端 initAuth() 守卫 + API 鉴权双重把关，
// 写法与 app/middleware/auth.global.ts 一致。
const CONFIGURABLE_ROLES = ['ADMIN', 'SONG_ADMIN', 'BROADCASTER', 'REVIEWER']

export default defineNuxtRouteMiddleware(async () => {
  const { user, isAuthenticated, initAuth } = useAuth()

  if (import.meta.client) {
    await initAuth()
  }

  // SSR 或尚未取得登入狀態時放行（auth.global 會處理未登入跳轉）
  if (!isAuthenticated.value) return

  const role = user.value?.role
  if (role === 'SUPER_ADMIN') return

  if (CONFIGURABLE_ROLES.includes(role)) {
    const effective = user.value?.effectivePages
    if (Array.isArray(effective)) {
      if (effective.includes('ops-board')) return
    } else if (role === 'ADMIN') {
      // 旧会话未下发生效页面：回退内置默认（ADMIN 默认含运维看板）
      return
    }
  }

  return navigateTo('/')
})

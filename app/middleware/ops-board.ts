import { useAuth } from '~/composables/useAuth'

// 看板僅 ADMIN / SUPER_ADMIN 可見（/api/ops-board/* 另有 requireAdmin 兜底）。
// 注意：app/plugins/auth.server.ts 已停用，SSR 階段 useState('user') 為空，
// 因此服務端不做重定向，交由客戶端 initAuth() 守衛 + API 鑑權雙重把關，
// 寫法與 app/middleware/auth.global.ts 一致。
export default defineNuxtRouteMiddleware(async () => {
  const { user, isAuthenticated, initAuth } = useAuth()

  if (import.meta.client) {
    await initAuth()
  }

  // SSR 或尚未取得登入狀態時放行（auth.global 會處理未登入跳轉）
  if (!isAuthenticated.value) return

  const role = user.value?.role
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    return navigateTo('/')
  }
})

/* Modified by YH-Chen-Eternity on 2026-10-23 */

// Modified by YH-Chen on 2026-10-17
import { computed } from 'vue'
import { useAuth } from './useAuth'
import { DEFAULT_ROLE_PAGES } from '~/types/rolePages'

export const usePermissions = () => {
  const auth = useAuth()

  // 检查用户是否可以访问后台
  const canAccessAdmin = computed(() => {
    if (!auth.user.value) return false
    const role = auth.user.value.role
    return ['SONG_ADMIN', 'BROADCASTER', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN'].includes(role)
  })

  // 检查用户是否可以访问指定页面
  // 可配置角色（ADMIN/SONG_ADMIN/BROADCASTER/REVIEWER）优先后端下发的 effectivePages
  // （超管在「角色权限」页配置，登录/verify 时随用户返回）；未下发时回退内置默认。
  const canAccessPage = (page: string): boolean => {
    if (!auth.user.value) return false

    const role = auth.user.value.role

    // 超级管理员可以访问所有页面
    if (role === 'SUPER_ADMIN') return true

    // 数据库与角色权限配置页为超管专属
    if (page === 'database' || page === 'role-permissions') return false

    const effective = auth.user.value.effectivePages
    if (Array.isArray(effective)) {
      // 纵深防御：超管专属页不因 effectivePages 下发而放行（上方已硬拦截，此处兜底过滤）
      return effective.includes(page) && page !== 'database' && page !== 'role-permissions'
    }

    // 回退：内置默认页面（单一来源 types/rolePages DEFAULT_ROLE_PAGES，与后端一致）
    return (DEFAULT_ROLE_PAGES as Record<string, string[]>)[role]?.includes(page) ?? false
  }

  // 获取用户可访问的页面列表
  const getUserPages = computed(() => {
    if (!auth.user.value) return []

    const role = auth.user.value.role

    // 可配置角色优先后端下发的生效页面；过滤超管专属页（纵深防御）
    const effective = auth.user.value.effectivePages
    if (role !== 'SUPER_ADMIN' && Array.isArray(effective)) {
      return effective.filter((p) => p !== 'database' && p !== 'role-permissions')
    }

    switch (role) {
      case 'SUPER_ADMIN':
        return [
          'overview',
          'schedule',
          'print',
          'songs',
          'users',
          'grade-class',
          'notifications',
          'smtp-config',
          'playtimes',
          'request-times',
          'semesters',
          'blacklist',
          'site-config',
          'database',
          'role-permissions',
          'api-keys',
          'data-analysis',
          'music-source',
          'review-notes',
          'review-users',
          'announcement',
          'system-board',
          'attack-logs',
          'edge-protection',
          'ops-notification',
          'community-review',
          'community-comment-review',
          'community-archive',
          'community-boards',
          'community-titles',
          'community-users',
          'community-settings',
          'community-reports',
          'community-overview'
        ]
      // 可配置角色默认页统一取自 types/rolePages DEFAULT_ROLE_PAGES（单一来源）
      case 'ADMIN':
        return [...DEFAULT_ROLE_PAGES.ADMIN]
      case 'SONG_ADMIN':
        return [...DEFAULT_ROLE_PAGES.SONG_ADMIN]
      case 'BROADCASTER':
        return [...DEFAULT_ROLE_PAGES.BROADCASTER]
      case 'REVIEWER':
        return [...DEFAULT_ROLE_PAGES.REVIEWER]
      default:
        return []
    }
  })

  // 角色检查
  const isUser = computed(() => auth.user.value?.role === 'USER')
  // 发稿员：普通用户层级，仅豁免社区发帖/评论/图片限流，不进入管理后台
  const isContributor = computed(() => auth.user.value?.role === 'CONTRIBUTOR')
  const isSongAdmin = computed(() => auth.user.value?.role === 'SONG_ADMIN')
  const isBroadcaster = computed(() => auth.user.value?.role === 'BROADCASTER')
  const isReviewer = computed(() => auth.user.value?.role === 'REVIEWER')
  const isAdmin = computed(() => auth.user.value?.role === 'ADMIN')
  const isSuperAdmin = computed(() => auth.user.value?.role === 'SUPER_ADMIN')

  // 权限组合检查
  const isAdminOrAbove = computed(() => {
    const role = auth.user.value?.role
    return ['ADMIN', 'SUPER_ADMIN'].includes(role)
  })

  const isSongAdminOrAbove = computed(() => {
    const role = auth.user.value?.role
    return ['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(role)
  })

  // 检查是否可以管理用户角色
  const canManageUserRole = (targetRole: string): boolean => {
    if (!auth.user.value) return false

    // 只有超级管理员可以分配角色
    if (auth.user.value.role === 'SUPER_ADMIN') {
      return ['USER', 'CONTRIBUTOR', 'SONG_ADMIN', 'BROADCASTER', 'REVIEWER', 'ADMIN'].includes(targetRole)
    }

    return false
  }

  // 社区权限
  const canReviewCommunity = computed(() => {
    const role = auth.user.value?.role
    return ['REVIEWER', 'ADMIN', 'SUPER_ADMIN'].includes(role || '')
  })

  const isCommunityAdmin = computed(() => ['ADMIN', 'SUPER_ADMIN'].includes(auth.user.value?.role || ''))

  // 检查是否可以打印排期
  const canPrintSchedule = computed(() => {
    if (!auth.user.value) return false
    const role = auth.user.value.role
    return ['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(role)
  })

  return {
    // 页面访问权限
    canAccessAdmin,
    canAccessPage,
    getUserPages,

    // 角色检查
    isUser,
    isContributor,
    isSongAdmin,
    isBroadcaster,
    isReviewer,
    isAdmin,
    isSuperAdmin,
    isAdminOrAbove,
    isSongAdminOrAbove,

    // 功能权限
    canPrintSchedule,

    // 社区权限
    canReviewCommunity,
    isCommunityAdmin,

    // 用户管理权限
    canManageUserRole
  }
}

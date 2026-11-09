/* Modified by YH-Chen-Eternity on 2026-10-23 */

// Modified by YH-Chen on 2026-10-17
import { computed } from 'vue'
import { useAuth } from './useAuth'
import {
  ADMIN_CONSOLE_ROLES,
  MANAGER_ROLES,
  PAGE_PERMISSIONS,
  PRIV_GRANT,
  PRIV_ROLE_TEMPLATE,
  canAccessAdminConsole,
  canAccessAdminPage,
  canAssignRole,
  canUseAdminPage,
  hasPermission,
} from '~/utils/admin-permissions'

export const usePermissions = () => {
  const auth = useAuth()

  // 检查用户是否可以访问后台
  const canAccessAdmin = computed(() => {
    if (!auth.user.value) return false
    const role = auth.user.value.role
    return ['SONG_ADMIN', 'BROADCASTER', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN'].includes(role)
  })

  // 检查用户是否可以访问指定页面
  const canAccessPage = (page: string): boolean => {
    if (!auth.user.value) return false

    const role = auth.user.value.role

    // 超级管理员可以访问所有页面
    if (role === 'SUPER_ADMIN') return true

    // 管理员可以访问的页面
    if (role === 'ADMIN') {
      return ['overview', 'schedule', 'print', 'songs', 'users', 'grade-class', 'playtimes', 'request-times', 'semesters', 'data-analysis', 'card-codes', 'music-source', 'review-notes', 'review-users', 'announcement', 'attack-logs', 'community-review', 'community-comment-review', 'community-archive', 'community-boards', 'community-titles', 'community-users', 'community-settings', 'community-reports', 'community-overview'].includes(page)
    }

    // 歌曲管理员可以访问的页面
    if (role === 'SONG_ADMIN') {
      return ['overview', 'schedule', 'print', 'songs', 'playtimes', 'request-times', 'semesters', 'data-analysis', 'card-codes'].includes(page)
    }

    // 放歌员仅能查看概览、排期与打印
    if (role === 'BROADCASTER') {
      return ['overview', 'schedule', 'print'].includes(page)
    }

    // 审帖员 = 普通用户 + 帖子/评论审核 + 归档查看
    if (role === 'REVIEWER') {
      return ['community-review', 'community-comment-review', 'community-archive', 'community-reports'].includes(page)
    }

    return false
  }

  // 检查用户是否可以访问指定页面
  const canAccessPage = (page: string): boolean => canAccessAdminPage(perms.value, page)
  const canUsePage = (page: string): boolean => canUseAdminPage(perms.value, page)
  const can = (code: string): boolean => canAccessAdmin.value && hasPermission(perms.value, code)

  // 获取用户可访问的页面列表（修改密码不属于后台页面）
  const getUserPages = computed(() =>
    Object.keys(PAGE_PERMISSIONS).filter((page) => page !== 'password' && canAccessAdminPage(perms.value, page))
  )

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
          'api-keys',
          'data-analysis',
          'music-source',
          'review-notes',
          'review-users',
          'announcement',
          'system-board',
          'attack-logs',
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
      case 'ADMIN':
        return ['overview', 'schedule', 'print', 'songs', 'users', 'grade-class', 'playtimes', 'request-times', 'semesters', 'data-analysis', 'card-codes', 'music-source', 'review-notes', 'review-users', 'announcement', 'attack-logs', 'community-review', 'community-comment-review', 'community-archive', 'community-boards', 'community-titles', 'community-users', 'community-settings', 'community-reports', 'community-overview']
      case 'SONG_ADMIN':
        return ['overview', 'schedule', 'print', 'songs', 'playtimes', 'request-times', 'semesters', 'data-analysis', 'card-codes']
      case 'BROADCASTER':
        return ['overview', 'schedule', 'print']
      case 'REVIEWER':
        return ['community-review', 'community-comment-review', 'community-archive', 'community-reports']
      default:
        return []
    }
  })

  // 角色检查
  const isUser = computed(() => auth.user.value?.role === 'USER')
  const isSongAdmin = computed(() => auth.user.value?.role === 'SONG_ADMIN')
  const isBroadcaster = computed(() => auth.user.value?.role === 'BROADCASTER')
  const isReviewer = computed(() => auth.user.value?.role === 'REVIEWER')
  const isAdmin = computed(() => auth.user.value?.role === 'ADMIN')
  const isSuperAdmin = computed(() => auth.user.value?.role === 'SUPER_ADMIN')

  const isAdminOrAbove = computed(() => MANAGER_ROLES.includes(auth.user.value?.role || ''))
  const isSongAdminOrAbove = computed(() => ADMIN_CONSOLE_ROLES.includes(auth.user.value?.role || ''))

    // 只有超级管理员可以分配角色
    if (auth.user.value.role === 'SUPER_ADMIN') {
      return ['USER', 'SONG_ADMIN', 'BROADCASTER', 'REVIEWER', 'ADMIN'].includes(targetRole)
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
  const canPrintSchedule = computed(() => can('schedule:read'))

  // 授权能力：编辑角色模板（权限矩阵）/ 按用户显式授权
  const canManageRoleTemplates = computed(() => can(PRIV_ROLE_TEMPLATE))
  const canGrantPermissions = computed(() => can(PRIV_GRANT))

  return {
    // 权限码
    perms,
    can,

    // 页面访问权限
    canAccessAdmin,
    canAccessPage,
    canUsePage,
    getUserPages,

    // 角色检查
    isUser,
    isSongAdmin,
    isBroadcaster,
    isReviewer,
    isAdmin,
    isSuperAdmin,
    isAdminOrAbove,
    isSongAdminOrAbove,

    // 功能权限
    canPrintSchedule,
    canManageRoleTemplates,
    canGrantPermissions,

    // 社区权限
    canReviewCommunity,
    isCommunityAdmin,

    // 用户管理权限
    canManageUserRole
  }
}

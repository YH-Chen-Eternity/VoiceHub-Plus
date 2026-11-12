/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { createApiError } from '~~/server/utils/apiError'
import { resolveRequirePasswordChange } from '~~/server/utils/system-settings-helper'
import { getPasswordSetupState } from '~~/server/utils/initial-password-policy'
import { resolveAvatarSource } from '~~/server/utils/user-avatar'
import { resolveEffectivePages } from '~~/types/rolePages'
import { getRolePagesCached } from '~~/server/utils/rolePagesSettings'

export default defineEventHandler(async (event) => {
  const authUser = event.context.user
  if (!authUser) {
    throw createApiError(401, 'AUTH_TOKEN_MISSING', '未提供认证令牌')
  }

  const userId = authUser.id

  // 用户资料始终从数据库获取，避免权限和绑定状态缓存过期。
  const userResult = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      username: true,
      name: true,
      grade: true,
      class: true,
      role: true,
      password: true,
      forcePasswordChange: true,
      forceUsernameChange: true,
      passwordChangedAt: true,
      avatarProvider: true,
      avatarProviderUserId: true,
      email: true,
      emailVerified: true
    },
    with: {
      identities: {
        columns: {
          provider: true,
          providerUsername: true,
          providerUserId: true,
          avatar: true,
          createdAt: true
        }
      }
    }
  })

  const dbUser = userResult || null

  if (!dbUser) {
    throw createApiError(401, 'USER_NOT_FOUND', '用户不存在')
  }

  // 与登录接口保持一致：按系统开关与用户状态计算强制改密及首次设置密码状态
  const requirePasswordChange = await resolveRequirePasswordChange(dbUser)

  // 角色后台页面权限：仅可配置角色返回生效页面列表（超管恒为全部页面，无需下发）
  // rolePages 走 60s 进程内缓存，避免高并发 verify 重复查询 SystemSettings
  let effectivePages: string[] | undefined
  if (['ADMIN', 'SONG_ADMIN', 'BROADCASTER', 'REVIEWER'].includes(dbUser.role)) {
    effectivePages = resolveEffectivePages(dbUser.role, await getRolePagesCached()) ?? undefined
  }

  const passwordSetupState = getPasswordSetupState(dbUser, requirePasswordChange)

  // 构建返回的用户对象，只包含需要的字段
  const avatarSource = resolveAvatarSource(dbUser, dbUser.identities || [])
  const user = {
    id: dbUser.id,
    username: dbUser.username,
    name: dbUser.name,
    grade: dbUser.grade,
    class: dbUser.class,
    role: dbUser.role,
    forcePasswordChange: dbUser.forcePasswordChange,
    forceUsernameChange: dbUser.forceUsernameChange,
    passwordChangedAt: dbUser.passwordChangedAt,
    requirePasswordChange,
    ...passwordSetupState,
    has2FA: dbUser.identities?.some((id: any) => id.provider === 'totp') || false,
    avatar: avatarSource?.url ?? null,
    email: dbUser.email ?? null,
    emailVerified: !!dbUser.emailVerified,
    effectivePages
  }

  return {
    user,
    valid: true
  }
})

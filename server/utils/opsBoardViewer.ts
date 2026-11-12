/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 运维看板读端点鉴权：SUPER_ADMIN 恒可；可配置角色按超管配置的生效页面
 * （rolePages → resolveEffectivePages，含 ops-board）放行。
 * 与前端 app/middleware/ops-board.ts 同口径；写端点仍 requireSuperAdmin。
 * rolePages 走 60s 进程内缓存（rolePagesSettings），配置保存后立即失效。
 */
import type { H3Event } from 'h3'
import { createApiError } from './apiError'
import { getRolePagesCached } from './rolePagesSettings'
import { CONFIGURABLE_ROLES, resolveEffectivePages } from '~~/types/rolePages'

export async function requireOpsBoardViewer(event: H3Event) {
  const user = event?.context?.user
  if (!user) {
    throw createApiError(401, 'AUTH_UNAUTHORIZED', '请先登录')
  }
  if (user.role === 'SUPER_ADMIN') return user

  if ((CONFIGURABLE_ROLES as readonly string[]).includes(user.role)) {
    const rolePages = await getRolePagesCached()
    const pages = resolveEffectivePages(user.role, rolePages)
    if (pages?.includes('ops-board')) return user
  }

  throw createApiError(403, 'AUTH_FORBIDDEN', '无权访问运维看板')
}

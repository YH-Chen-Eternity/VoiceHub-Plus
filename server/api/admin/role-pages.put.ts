/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 角色后台页面权限：保存配置。仅超级管理员。
 * 全量提交四个可配置角色的页面数组；未出现的角色键视为「恢复默认」（从存储中删除键）。
 * 保存后写入管理审计日志，并在前端下次 verify 时生效。
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { requireSuperAdmin } from '~~/server/utils/requireAdmin'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'
import { setHeader } from 'h3'
import { CONFIGURABLE_ROLES, sanitizeRolePages } from '~~/types/rolePages'
import { invalidateRolePagesCache } from '~~/server/utils/rolePagesSettings'

export default defineEventHandler(async (event) => {
  requireSuperAdmin(event)
  setHeader(event, 'Cache-Control', 'no-store')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object') {
    throw createApiError(400, 'ROLE_PAGES_INVALID', '请求体无效')
  }

  // 允许按角色增量提交：只提交的角色键会被更新，未提交的角色保持原状
  const incoming = (body as { rolePages?: unknown }).rolePages
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw createApiError(400, 'ROLE_PAGES_INVALID', 'rolePages 必须是对象')
  }

  const rows = await db.select({ id: systemSettings.id, rolePages: systemSettings.rolePages }).from(systemSettings).limit(1)
  if (!rows[0]) {
    throw createApiError(500, 'ROLE_PAGES_NO_SETTINGS', '系统设置行不存在')
  }

  const merged: Record<string, string[]> = { ...(rows[0].rolePages ?? {}) }
  const sanitizedIncoming = sanitizeRolePages(incoming)
  // 提交值必须是该角色的合法页面数组（sanitize 已剔除非法项；键存在但值被清空 = 显式禁用全部）
  for (const [role, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (!(CONFIGURABLE_ROLES as readonly string[]).includes(role)) {
      throw createApiError(400, 'ROLE_PAGES_INVALID_ROLE', `不支持配置的角色：${role}`)
    }
    // null = 恢复该角色内置默认（从存储中删除键）
    if (value === null) {
      delete merged[role]
      continue
    }
    // 值必须是数组（sanitize 只会静默剔除非法键，这里显式给出准确错误）
    if (!Array.isArray(value)) {
      throw createApiError(400, 'ROLE_PAGES_INVALID_PAGES', `${role} 的页面列表必须是数组`)
    }
    if (!(role in sanitizedIncoming)) {
      throw createApiError(400, 'ROLE_PAGES_INVALID_PAGES', `${role} 的页面列表无效（页面 id 均不在白名单内）`)
    }
    merged[role] = sanitizedIncoming[role]
  }

  const updated = await db
    .update(systemSettings)
    .set({ rolePages: merged, updatedAt: new Date() })
    .where(eq(systemSettings.id, rows[0].id))
    .returning({ rolePages: systemSettings.rolePages })

  // 登录/verify 读取走 60s 缓存，保存后立即失效保证配置即时生效
  invalidateRolePagesCache()

  await writeAdminAudit(event, {
    action: 'ROLE_PAGES_UPDATE',
    detail: JSON.stringify({ roles: Object.keys(sanitizedIncoming) })
  })

  return { rolePages: updated[0]?.rolePages ?? merged }
})

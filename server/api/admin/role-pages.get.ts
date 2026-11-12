/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshiukaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 角色后台页面权限：读取当前配置与内置默认。仅超级管理员。
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { requireSuperAdmin } from '~~/server/utils/requireAdmin'
import { setHeader } from 'h3'
import { DEFAULT_ROLE_PAGES, normalizeRolePagesConfig } from '~~/types/rolePages'

export default defineEventHandler(async (event) => {
  requireSuperAdmin(event)
  setHeader(event, 'Cache-Control', 'no-store')

  const rows = await db.select({ rolePages: systemSettings.rolePages }).from(systemSettings).limit(1)

  // 回显用「当前版本视图」：旧快照里缺失的新增页（如 ops-board）按版本补齐后再给配置页，
  // 避免「服务端已按补齐后的页面放行、配置页却显示未勾选」的口径分裂。
  return {
    rolePages: normalizeRolePagesConfig(rows[0]?.rolePages ?? null),
    defaults: DEFAULT_ROLE_PAGES
  }
})

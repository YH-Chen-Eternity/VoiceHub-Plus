/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 管理后台角色页面权限的共享定义（前后端共用）。
 * 超级管理员可在后台「角色权限」页为 ADMIN / SONG_ADMIN / BROADCASTER / REVIEWER
 * 勾选可访问的后台页面；数据库（database）与角色权限配置页（role-permissions）
 * 为超级管理员专属，不可配置给其他角色。
 */

export const CONFIGURABLE_ROLES = ['ADMIN', 'SONG_ADMIN', 'BROADCASTER', 'REVIEWER'] as const
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number]

/** 超管专属、不参与角色权限配置的页面 */
export const SUPER_ADMIN_ONLY_PAGES = ['database', 'role-permissions'] as const

/** 全部可配置的后台页面 id（供配置页渲染与保存时白名单校验） */
export const CONFIGURABLE_PAGE_IDS = [
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
  'api-keys',
  'data-analysis',
  'card-codes',
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
] as const
export type ConfigurablePageId = (typeof CONFIGURABLE_PAGE_IDS)[number]

/** 各角色内置默认页面（与 usePermissions 的硬编码保持一致；配置缺省时使用） */
export const DEFAULT_ROLE_PAGES: Record<ConfigurableRole, string[]> = {
  ADMIN: [...CONFIGURABLE_PAGE_IDS],
  SONG_ADMIN: ['overview', 'schedule', 'print', 'songs', 'playtimes', 'request-times', 'semesters', 'data-analysis', 'card-codes'],
  BROADCASTER: ['overview', 'schedule', 'print'],
  REVIEWER: ['community-review', 'community-comment-review', 'community-reports']
}

/** 校验并规范化 rolePages 配置：非法键/非法页面 id 剔除；空数组合法（表示禁用全部可配置页） */
export const sanitizeRolePages = (input: unknown): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [role, pages] of Object.entries(input as Record<string, unknown>)) {
    if (!(CONFIGURABLE_ROLES as readonly string[]).includes(role)) continue
    if (!Array.isArray(pages)) continue
    const valid = [...new Set(pages.filter((p): p is string => typeof p === 'string' && (CONFIGURABLE_PAGE_IDS as readonly string[]).includes(p)))]
    out[role] = valid
  }
  return out
}

/** 计算某角色生效页面：配置含该角色键则用配置值，否则用内置默认。
 *  纵深防御：无论数据来源，一律过滤超管专属页面（防止绕过 API 直改库获得超管页）。 */
export const resolveEffectivePages = (role: string, rolePages: Record<string, string[]> | null | undefined): string[] | null => {
  if (!(CONFIGURABLE_ROLES as readonly string[]).includes(role)) return null
  const configured = rolePages?.[role]
  const pages = Array.isArray(configured)
    ? configured
    : DEFAULT_ROLE_PAGES[role as ConfigurableRole] || []
  return [...new Set(pages.filter((p) => !(SUPER_ADMIN_ONLY_PAGES as readonly string[]).includes(p)))]
}

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
  'ops-board',
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

/**
 * 配置结构版本 & 各版本新增的可配置页面。
 *
 * 背景：rolePages 一旦保存就是「全量快照」，后续版本新增的页面 id 不在快照里，
 * 会被当成「超管未开通」而静默吞掉（运维看板 ops-board 即如此：上线前保存的
 * ADMIN 快照里没有该 id，导致 ADMIN 看不到新看板、端点 403）。
 * 因此新增页面时必须登记到对应版本，读取时对版本更早的快照做**增量补齐**
 * （仅补该角色默认就含的页面）；超管在配置页重新保存后版本升到当前值，
 * 之后再取消勾选不会被自动补回。
 *
 * 新增可配置页面的三处同步（缺一处都会静默失效）：
 *   1) CONFIGURABLE_PAGE_IDS 加入页面 id；
 *   2) 需要默认开通的角色补进 DEFAULT_ROLE_PAGES；
 *   3) PAGES_ADDED_IN_VERSION 的**下一个**版本号里登记该 id，并把
 *      ROLE_PAGES_SCHEMA_VERSION 加 1（否则已保存的老快照看不到新页面）。
 */
export const ROLE_PAGES_SCHEMA_VERSION = 2
export const PAGES_ADDED_IN_VERSION: Record<number, readonly string[]> = {
  2: ['ops-board']
}

/**
 * rolePages 的存储形态：角色键 → 页面 id 数组，外加可选 `__version` 结构版本号。
 * 与 app/drizzle/schema.ts 的 `SystemSettings.rolePages` jsonb 列类型保持一致
 * （Record<string, string[] | number>），否则写入数字版本号会与列类型声明冲突。
 */
export type RolePagesConfig = Record<string, string[] | number>

/** 计算某角色生效页面：配置含该角色键则用配置值，否则用内置默认。
 *  纵深防御：无论数据来源，一律过滤超管专属页面（防止绕过 API 直改库获得超管页）。 */
export const resolveEffectivePages = (role: string, rolePages: RolePagesConfig | null | undefined): string[] | null => {
  if (!(CONFIGURABLE_ROLES as readonly string[]).includes(role)) return null
  const configured = rolePages?.[role]
  const defaults = DEFAULT_ROLE_PAGES[role as ConfigurableRole] || []
  let pages: string[]
  if (Array.isArray(configured)) {
    // 快照 + 版本增量补齐：只补该角色默认就含的新增页面，显式取消的其他页面不动
    pages = [...configured]
    const rawVersion = rolePages?.__version
    const storedVersion = typeof rawVersion === 'number' ? rawVersion : Number(rawVersion ?? 1)
    const from = Number.isFinite(storedVersion) ? Math.max(1, Math.floor(storedVersion)) : 1
    for (let v = from + 1; v <= ROLE_PAGES_SCHEMA_VERSION; v++) {
      for (const pid of PAGES_ADDED_IN_VERSION[v] || []) {
        if (defaults.includes(pid) && !pages.includes(pid)) pages.push(pid)
      }
    }
  } else {
    pages = defaults
  }
  return [...new Set(pages.filter((p) => !(SUPER_ADMIN_ONLY_PAGES as readonly string[]).includes(p)))]
}

/**
 * 页面 id → /api/admin/* 路由模式映射：角色权限配置的**端点级强制**依据。
 * zz-admin-guard 对可配置角色的请求做映射检查：请求路径命中的页面集合中
 * 若没有任何一个在生效页面内 → 403（SUPER_ADMIN 直通；未映射路径不强制，
 * 保持既有角色判定，避免误伤跨页面辅助端点与超管专属页面）。
 * 一个端点可属于多个页面（任一生效即可访问）。
 *
 * 注意：ops-board 不在本映射中——其端点位于 /api/ops-board/ 而非
 * /api/admin/，由 server/utils/opsBoardViewer.requireOpsBoardViewer
 * 按 rolePages 生效页面独立把关（口径与本映射一致）。
 */
export const ADMIN_PAGE_ROUTES: ReadonlyArray<readonly [string, RegExp[]]> = [
  ['overview', [/^\/api\/admin\/activities$/, /^\/api\/admin\/stats$/, /^\/api\/admin\/replay-requests(?:\/|$)/]],
  ['schedule', [/^\/api\/admin\/schedule(?:\/|$)/, /^\/api\/admin\/songs\/mark-played$/, /^\/api\/admin\/play-times(?:\/|$)/, /^\/api\/admin\/semesters(?:\/|$)/, /^\/api\/admin\/replay-requests(?:\/|$)/]],
  ['songs', [/^\/api\/admin\/songs(?:\/|$)/]],
  ['users', [/^\/api\/admin\/users(?:\/|$)/]],
  ['grade-class', [/^\/api\/admin\/grade-class(?:\/|$)/]],
  ['notifications', [/^\/api\/admin\/notifications(?:\/|$)/, /^\/api\/admin\/email-templates(?:\/|$)/]],
  ['smtp-config', [/^\/api\/admin\/smtp(?:\/|$)/]],
  ['playtimes', [/^\/api\/admin\/play-times(?:\/|$)/]],
  ['request-times', [/^\/api\/admin\/request-times(?:\/|$)/]],
  ['semesters', [/^\/api\/admin\/semesters(?:\/|$)/]],
  ['blacklist', [/^\/api\/admin\/blacklist(?:\/|$)/, /^\/api\/admin\/ban-ip$/, /^\/api\/admin\/permanent-bans(?:\/|$)/]],
  ['site-config', [/^\/api\/admin\/system-settings(?:\/|$)/, /^\/api\/admin\/geo-lock(?:\/|$)/, /^\/api\/admin\/trusted-ips(?:\/|$)/]],
  ['api-keys', [/^\/api\/admin\/api-keys(?:\/|$)/]],
  ['data-analysis', [/^\/api\/admin\/stats(?:\/|$)/]],
  ['card-codes', [/^\/api\/admin\/card-codes(?:\/|$)/]],
  ['music-source', [/^\/api\/admin\/music-source-plugins(?:\/|$)/]],
  ['review-notes', [/^\/api\/admin\/review\/notes(?:\/|$)/]],
  ['review-users', [/^\/api\/admin\/review\/users(?:\/|$)/]],
  ['announcement', [/^\/api\/admin\/announcements(?:\/|$)/]],
  ['system-board', [/^\/api\/admin\/system-board(?:\/|$)/, /^\/api\/admin\/bot-scores(?:\/|$)/]],
  ['attack-logs', [/^\/api\/admin\/attack-logs(?:\/|$)/]],
  ['edge-protection', [/^\/api\/admin\/edge-config(?:\/|$)/, /^\/api\/admin\/edge-stats(?:\/|$)/]],
  ['ops-notification', [/^\/api\/admin\/ops-notification(?:\/|$)/]],
  ['community-review', [/^\/api\/admin\/community\/review(?:\/|$)/, /^\/api\/admin\/community\/posts(?:\/|$)/, /^\/api\/admin\/community\/boards(?:\/|$)/]],
  ['community-archive', [/^\/api\/admin\/community\/archive(?:\/|$)/]],
  ['community-boards', [/^\/api\/admin\/community\/boards(?:\/|$)/]],
  ['community-titles', [/^\/api\/admin\/community\/titles(?:\/|$)/]],
  ['community-users', [/^\/api\/admin\/community\/users(?:\/|$)/]],
  ['community-reports', [/^\/api\/admin\/community\/reports(?:\/|$)/, /^\/api\/admin\/community\/appeals(?:\/|$)/]],
  ['community-settings', [/^\/api\/admin\/community\/settings(?:\/|$)/]],
  ['community-overview', [/^\/api\/admin\/community\/overview(?:\/|$)/]]
] as const

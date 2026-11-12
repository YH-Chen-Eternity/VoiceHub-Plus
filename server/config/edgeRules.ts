/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 *
 * VoiceHub 自研边缘层（deploy/rewriter/app-rewriter.js）可配置规则的元数据。
 * 后端 edge-config API 的校验、后台 EdgeProtection.vue 的展示都从这里取值，
 * 保证「规则开关 / 频率阈值」的键名与范围在前后端与 rewriter 之间唯一对齐。
 *
 * 注意：rewriter 是独立的 node:22-alpine 容器（无 TS、无构建步骤），
 * 其内部保有一份等价的纯 JS 常量副本；增删键时必须同步 app-rewriter.js。
 */

export const EDGE_RULE_KEYS = [
  'script',
  'brute_force',
  'enumeration',
  'banned',
  'region',
  'bot',
  'sameOrigin'
] as const
export type EdgeRuleKey = (typeof EDGE_RULE_KEYS)[number]

export const EDGE_RATE_LIMIT_KEYS = [
  'RL_MUSIC_PER_MIN',
  'RL_AUTH_PER_MIN',
  'RL_SEARCH_PER_MIN',
  'RL_ADMIN_PER_MIN',
  'RL_GLOBAL_PER_MIN',
  'ATK_LOGIN_MAX',
  'ATK_FAIL_MAX',
  'ATK_SEARCH_MAX',
  'ATK_PERMA_FAILS',
  'BOT_BLOCK_SCORE'
] as const
export type EdgeRateLimitKey = (typeof EDGE_RATE_LIMIT_KEYS)[number]

export interface EdgeConfig {
  /** 全站观察模式：true 时所有命中只记日志、不拦截 */
  observeMode: boolean
  /** 每条拦截规则的开关 */
  ruleSwitches: Record<EdgeRuleKey, boolean>
  /** 可调频率阈值，数值含义见 EDGE_RATE_LIMIT_META */
  rateLimits: Record<EdgeRateLimitKey, number>
}

export type EdgeRuleGroup = 'script' | 'brute' | 'geo' | 'rate'

export interface EdgeRuleMeta {
  key: EdgeRuleKey
  group: EdgeRuleGroup
  labelKey: string
  description: string
}

export const EDGE_RULES: EdgeRuleMeta[] = [
  { key: 'script', group: 'script', labelKey: 'ruleScript', description: '脚本/爬虫 UA 黑名单（仅作用于鉴权与用户类接口）' },
  { key: 'brute_force', group: 'brute', labelKey: 'ruleBruteForce', description: '短时间内大量登录失败的撞库检测' },
  { key: 'enumeration', group: 'brute', labelKey: 'ruleEnumeration', description: '批量遍历账号/资源的枚举检测' },
  { key: 'banned', group: 'geo', labelKey: 'ruleBanned', description: '永久封禁 IP 名单拦截' },
  { key: 'region', group: 'geo', labelKey: 'ruleRegion', description: '地域闸（按 CIDR 白名单限制来源）' },
  { key: 'bot', group: 'geo', labelKey: 'ruleBot', description: 'Bot 评分超过阈值时拦截' },
  { key: 'sameOrigin', group: 'geo', labelKey: 'ruleSameOrigin', description: '同源/代理一致性校验' }
]

export interface EdgeRateLimitMeta {
  key: EdgeRateLimitKey
  label: string
  min: number
  max: number
  unit: string
}

/** 与 app-rewriter.js 现有 env 默认值保持一致 */
export const EDGE_RATE_LIMIT_META: EdgeRateLimitMeta[] = [
  { key: 'RL_MUSIC_PER_MIN', label: '音乐接口每分钟上限', min: 10, max: 100000, unit: '次/分' },
  { key: 'RL_AUTH_PER_MIN', label: '鉴权接口每分钟上限', min: 5, max: 100000, unit: '次/分' },
  { key: 'RL_SEARCH_PER_MIN', label: '搜索接口每分钟上限', min: 10, max: 100000, unit: '次/分' },
  { key: 'RL_ADMIN_PER_MIN', label: '管理接口每分钟上限', min: 10, max: 100000, unit: '次/分' },
  { key: 'RL_GLOBAL_PER_MIN', label: '全站每分钟上限', min: 100, max: 1000000, unit: '次/分' },
  { key: 'ATK_LOGIN_MAX', label: '登录失败窗口阈值', min: 3, max: 10000, unit: '次/10分' },
  { key: 'ATK_FAIL_MAX', label: '累计失败阈值', min: 3, max: 10000, unit: '次' },
  { key: 'ATK_SEARCH_MAX', label: '搜索异常阈值', min: 3, max: 10000, unit: '次/分' },
  { key: 'ATK_PERMA_FAILS', label: '永久封禁触发失败数', min: 3, max: 100000, unit: '次/时' },
  { key: 'BOT_BLOCK_SCORE', label: 'Bot 评分拦截阈值', min: 1, max: 100, unit: '分' }
]

/**
 * rewriter 现有 env 默认值（缺省回落用）。
 * 注意 region 默认 false：rewriter 的地域闸由 GEO_GATE==='1' 显式开启，
 * 未配置 env 时保持关闭；「恢复默认」不应意外把全站切到仅中国大陆放行。
 * 必须与 deploy/rewriter/app-rewriter.js 的 defaultEdgeConfig() 保持一致。
 */
export const DEFAULT_EDGE_CONFIG: EdgeConfig = {
  observeMode: false,
  ruleSwitches: {
    script: true,
    brute_force: true,
    enumeration: true,
    banned: true,
    region: false,
    bot: true,
    sameOrigin: true
  },
  rateLimits: {
    RL_MUSIC_PER_MIN: 60,
    RL_AUTH_PER_MIN: 30,
    RL_SEARCH_PER_MIN: 60,
    RL_ADMIN_PER_MIN: 120,
    RL_GLOBAL_PER_MIN: 1800,
    ATK_LOGIN_MAX: 45,
    ATK_FAIL_MAX: 18,
    ATK_SEARCH_MAX: 20,
    ATK_PERMA_FAILS: 30,
    BOT_BLOCK_SCORE: 9
  }
}

/**
 * 把任意输入收敛成合法 EdgeConfig：
 * - 未知键一律丢弃（防止注入 rewriter 未定义的字段）
 * - 布尔字段只接受 boolean
 * - 阈值必须是有限数字，按 EDGE_RATE_LIMIT_META 的 min/max 夹取并取整
 * - 未提供的字段沿用默认值，保证结构永远完整
 */
export function sanitizeEdgeConfig(input: unknown): EdgeConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const ruleSwitches = { ...DEFAULT_EDGE_CONFIG.ruleSwitches }
  const rateLimits = { ...DEFAULT_EDGE_CONFIG.rateLimits }

  const switches = raw.ruleSwitches
  if (switches && typeof switches === 'object') {
    for (const key of EDGE_RULE_KEYS) {
      const value = (switches as Record<string, unknown>)[key]
      if (typeof value === 'boolean') ruleSwitches[key] = value
    }
  }

  const limits = raw.rateLimits
  if (limits && typeof limits === 'object') {
    for (const meta of EDGE_RATE_LIMIT_META) {
      const value = (limits as Record<string, unknown>)[meta.key]
      if (value === undefined || value === null || value === '') continue
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) continue
      rateLimits[meta.key] = Math.min(meta.max, Math.max(meta.min, Math.trunc(parsed)))
    }
  }

  return {
    observeMode: typeof raw.observeMode === 'boolean' ? raw.observeMode : DEFAULT_EDGE_CONFIG.observeMode,
    ruleSwitches,
    rateLimits
  }
}

/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import {
  EDGE_RATE_LIMIT_META,
  EDGE_RULE_KEYS,
  sanitizeEdgeConfig,
  type EdgeConfig
} from '~~/server/config/edgeRules'
import { createApiError } from '~~/server/utils/apiError'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { getEdgeConfig, setEdgeConfig } from '~~/server/utils/rewriterBans'

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setHeader(event, 'Cache-Control', 'no-store')

  const body = await readBody(event).catch(() => null)
  if (!isPlainObject(body)) {
    throw createApiError(400, 'EDGE_CONFIG_INVALID', '请求体无效')
  }
  if (typeof body.observeMode !== 'boolean') {
    throw createApiError(400, 'EDGE_CONFIG_INVALID', 'observeMode 必须为布尔值')
  }
  const rsRaw = body.ruleSwitches
  const rlRaw = body.rateLimits
  if (!isPlainObject(rsRaw) || !isPlainObject(rlRaw)) {
    throw createApiError(400, 'EDGE_CONFIG_INVALID', 'ruleSwitches / rateLimits 无效')
  }

  // 键白名单：拒绝任何未登记的键（与 edgeRules.ts 唯一事实来源对齐）
  for (const k of Object.keys(rsRaw)) {
    if (!EDGE_RULE_KEYS.some((x) => x === k)) {
      throw createApiError(400, 'EDGE_CONFIG_INVALID', `未知规则开关: ${k}`)
    }
  }
  for (const k of Object.keys(rlRaw)) {
    if (!EDGE_RATE_LIMIT_META.some((m) => m.key === k)) {
      throw createApiError(400, 'EDGE_CONFIG_INVALID', `未知阈值: ${k}`)
    }
  }
  // 类型 + 范围（严格拒绝非法值；rewriter 端再做 clamp 防呆）
  for (const k of EDGE_RULE_KEYS) {
    if (typeof rsRaw[k] !== 'boolean') {
      throw createApiError(400, 'EDGE_CONFIG_INVALID', `规则开关 ${k} 必须为布尔值`)
    }
  }
  for (const meta of EDGE_RATE_LIMIT_META) {
    const v = rlRaw[meta.key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < meta.min || v > meta.max) {
      throw createApiError(400, 'EDGE_CONFIG_INVALID', `阈值 ${meta.key} 必须介于 ${meta.min} 与 ${meta.max} 之间`)
    }
  }

  // 复用主 agent 的 sanitize 收敛成结构完整、键型别精确的 EdgeConfig
  const cfg: EdgeConfig = sanitizeEdgeConfig(body)
  await setEdgeConfig(cfg)
  // 保存后回读，返回边缘层实际生效的配置
  return await getEdgeConfig()
})

/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { gte, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { attackLogs } from '~/drizzle/schema'
import { requireAdmin } from '~~/server/utils/requireAdmin'

// 边缘防护面板按规则展示命中数，固定输出这 5 类（无数据补 0）
const KINDS = ['banned', 'brute_force', 'enumeration', 'script', 'region']

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setHeader(event, 'Cache-Control', 'no-store')

  const rows = await db
    .select({
      kind: attackLogs.kind,
      count24h: sql<number>`count(*)::int`,
      lastHit: sql<Date | null>`max(${attackLogs.createdAt})`
    })
    .from(attackLogs)
    .where(gte(attackLogs.createdAt, sql`now() - (${24} || ' hours')::interval`))
    .groupBy(attackLogs.kind)

  const byKind = new Map(rows.map((r) => [r.kind, r]))
  const perRule = KINDS.map((kind) => {
    const row = byKind.get(kind)
    return {
      kind,
      count24h: row ? Number(row.count24h) : 0,
      lastHit: row && row.lastHit ? new Date(String(row.lastHit)).toISOString() : null
    }
  })

  return { perRule }
})

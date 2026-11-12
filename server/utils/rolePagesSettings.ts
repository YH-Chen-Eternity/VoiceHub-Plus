/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * rolePages 配置的进程内 TTL 缓存。
 * login/verify 每次都会读取 SystemSettings.rolePages 计算生效页面，
 * 高并发登录下会产生大量重复查询；这里加 60 秒进程内缓存，
 * 保存配置（role-pages PUT）时主动失效，变更最迟 60 秒生效。
 *
 * ⚠️ 部署形态限制：当前生产为单容器单实例，进程内缓存即全局缓存；
 * 若未来改为多实例/多容器部署，各实例缓存不自动同步，
 * 权限变更在其他实例上最迟 60 秒生效。如需强一致性，
 * 请改用 Redis（已有 voicehub-redis）共享缓存或直接取消缓存。
 */
import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import type { RolePagesConfig } from '~~/types/rolePages'

const TTL_MS = 60_000

let cache: { at: number; value: RolePagesConfig | null } | null = null

export async function getRolePagesCached(): Promise<RolePagesConfig | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const rows = await db
    .select({ rolePages: systemSettings.rolePages })
    .from(systemSettings)
    .limit(1)
  const value = rows[0]?.rolePages ?? null
  cache = { at: Date.now(), value }
  return value
}

/** 保存新配置后调用，让下一次读取立即拿到最新值。 */
export function invalidateRolePagesCache(): void {
  cache = null
}

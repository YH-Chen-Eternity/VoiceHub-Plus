/**
 * 應用側日誌清理。requireSuperAdmin + 手動審計。
 *
 * body: { days: number (1~3650), dryRun: boolean }
 *   - dryRun 預設 true（安全預設），僅回傳將刪除的列數，不寫入。
 *   - 實刪範圍：AttackLog / LoginAttempt / AdminAuditLog 的 createdAt < now - days。
 *   - 雷池攻擊日誌位於外部 mgt 庫：本看板對外部庫純唯讀，只回傳
 *     safelineCleanup:'manual' 提示至雷池 UI 處理，絕不寫外部庫。
 */
import { defineEventHandler, readBody } from 'h3'
import { count, lt } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { attackLogs, loginAttempts, adminAuditLogs } from '~/drizzle/schema'
import { requireSuperAdmin } from '~~/server/utils/requireAdmin'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'
import { safeQuery, setOpsBoardNoStore } from '../_shared'

// 三張表都有 createdAt 欄位；以 any 承接可避開 union 表型別的泛型衝突，
// 實際查詢仍由 drizzle 以參數化 SQL 執行（lt 綁定 Date 參數）。
const TARGETS: { key: string; label: string; table: any }[] = [
  { key: 'attackLogs', label: 'AttackLog', table: attackLogs },
  { key: 'loginAttempts', label: 'LoginAttempt', table: loginAttempts },
  { key: 'adminAuditLogs', label: 'AdminAuditLog', table: adminAuditLogs }
]

async function countBefore(table: any, cutoff: Date): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(table)
    .where(lt(table.createdAt, cutoff))
  return Number(row?.total ?? 0)
}

export default defineEventHandler(async (event) => {
  requireSuperAdmin(event)
  setOpsBoardNoStore(event)

  const body = (await readBody(event).catch(() => ({}))) as {
    days?: unknown
    dryRun?: unknown
  }
  const days = Number(body?.days)
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw createApiError(400, 'OPS_BOARD_CLEANUP_INVALID_DAYS', 'days 必须在 1~3650 之间')
  }
  // 未明確傳 dryRun:false 時一律只預覽不刪除。
  const dryRun = body?.dryRun !== false
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000)

  const counts: Record<string, number> = {}
  for (const target of TARGETS) {
    counts[target.key] = await safeQuery(
      `cleanup:count:${target.key}`,
      () => countBefore(target.table, cutoff),
      0
    )
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)

  const deleted: Record<string, number> = {}
  if (!dryRun) {
    for (const target of TARGETS) {
      deleted[target.key] = await safeQuery(
        `cleanup:delete:${target.key}`,
        async () => {
          await db.delete(target.table).where(lt(target.table.createdAt, cutoff))
          return counts[target.key]
        },
        0
      )
    }
  }

  const action = dryRun
    ? 'OPS_BOARD_LOG_CLEANUP_PREVIEW'
    : 'OPS_BOARD_LOG_CLEANUP_EXECUTE'
  const detail = JSON.stringify({
    days,
    dryRun,
    cutoff: cutoff.toISOString(),
    counts,
    total,
    deleted
  })
  await writeAdminAudit(event, { action, target: 'ops-board/logs', detail })
  console.info(
    '[ops-board][audit]',
    JSON.stringify({ action, at: new Date().toISOString(), days, dryRun, counts, total })
  )

  return {
    ok: true,
    dryRun,
    days,
    cutoff: cutoff.toISOString(),
    counts,
    total,
    deleted: dryRun
      ? 0
      : Object.values(deleted).reduce((sum, value) => sum + value, 0),
    safelineCleanup: 'manual',
    safelineCleanupHint: '雷池攻击日志位于外部 mgt 库，看板不写外部库，请到雷池 UI 手动清理'
  }
})

/**
 * 社区归档「彻底删除」的请求归一化与边界常量。
 *
 * 纯函数，不依赖 h3 / 数据库，便于单元测试覆盖请求边界。
 * 与恢复（restoreArchivedCommunityContent）、到期自动清理（purgeExpiredCommunityContent）
 * 并列，是管理后台主动删除归档记录的第三条链路。
 */

/** 单批删除条数：与到期自动清理的批量上限保持一致 */
export const PURGE_BATCH_SIZE = 200
/** 单次请求累计删除上限：避免一次「清空」长时间占用数据库连接 */
export const PURGE_MAX_TOTAL = 5000
/** 指定 id 删除时单次最多条数 */
export const PURGE_MAX_IDS = 200

export type ArchivePurgeType = 'post' | 'comment'

export type ArchivePurgeScope = {
  type: ArchivePurgeType
  /** 范围清空时的板块约束；undefined 表示全部板块 */
  boardId?: number
  /** 指定记录删除时的 id 白名单；范围清空时为 undefined */
  ids?: number[]
  /** true = 清空当前范围；false = 只删 ids 指定的记录 */
  all: boolean
}

export type NormalizePurgeResult =
  | { ok: true; value: ArchivePurgeScope }
  | { ok: false; code: 'COMMUNITY_ARCHIVE_PURGE_INVALID'; message: string }

/** 兼容归档页 Tab 的复数写法与恢复端点的单复数写法 */
export function normalizeArchivePurgeType(value: unknown): ArchivePurgeType | null {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'post' || text === 'posts') return 'post'
  if (text === 'comment' || text === 'comments') return 'comment'
  return null
}

/** 只接受正整数 id，去重且保序 */
export function normalizePurgeIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0))
  )
}

/**
 * 请求体归一化：
 * - all=true 表示清空当前 type + boardId 范围内的全部归档；
 * - 否则必须显式给出 ids（单条删除即长度 1 的数组），杜绝「空 ids 误删全站」；
 * - all 与 ids 互斥；指定 id 时忽略板块条件（id 已是精确范围，且权限为全站管理员）。
 */
export function normalizeArchivePurgeRequest(body: unknown): NormalizePurgeResult {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const type = normalizeArchivePurgeType(raw.type)
  if (!type) {
    return { ok: false, code: 'COMMUNITY_ARCHIVE_PURGE_INVALID', message: '归档类型不正确' }
  }

  const all = raw.all === true
  const ids = normalizePurgeIds(raw.ids)
  const invalid = (message: string): NormalizePurgeResult => ({
    ok: false,
    code: 'COMMUNITY_ARCHIVE_PURGE_INVALID',
    message
  })

  if (all && ids.length) return invalid('范围清空与指定记录不能同时使用')
  if (!all && !ids.length) return invalid('请指定要删除的归档记录')
  if (ids.length > PURGE_MAX_IDS) return invalid(`单次最多删除 ${PURGE_MAX_IDS} 条归档记录`)

  const boardRaw = Number(raw.boardId ?? 0)
  const boardId = Number.isInteger(boardRaw) && boardRaw > 0 ? boardRaw : undefined

  return {
    ok: true,
    value: {
      type,
      all,
      // ids 模式下 id 已是精确范围，不带板块条件，避免筛选切换与列表刷新之间的竞态误判
      boardId: all ? boardId : undefined,
      ids: all ? undefined : ids
    }
  }
}

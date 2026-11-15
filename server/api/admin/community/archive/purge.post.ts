import { readBody } from 'h3'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { purgeArchivedCommunityContent } from '~~/server/utils/communityArchive'
import { normalizeArchivePurgeRequest } from '~~/server/utils/communityArchivePurge'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'

/**
 * 管理后台「社区归档记录」彻底删除（物理删除，不可恢复）。
 *
 * POST /api/admin/community/archive/purge
 *   { type: 'posts' | 'comments', all: true, boardId?: number }
 *     → 清空当前 Tab + 板块范围内的全部归档；
 *   { type: 'posts' | 'comments', ids: number[] }
 *     → 只删指定记录（单条删除即传一个 id）。
 *
 * 鉴权与归档列表 / 恢复一致：仅管理员 / 超级管理员。
 * 请求归一化与边界校验在 communityArchivePurge.ts（纯函数，已单测覆盖）。
 */
export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)

  const body = await readBody(event)
  const parsed = normalizeArchivePurgeRequest(body)
  if (!parsed.ok) throw createApiError(400, parsed.code, parsed.message)

  const scope = parsed.value
  const result = await purgeArchivedCommunityContent(scope)

  const label = scope.type === 'post' ? '帖子' : '评论'
  const mode = scope.all
    ? `清空范围（板块 ${scope.boardId ?? '全部'}）`
    : `指定 ${scope.ids?.length ?? 0} 条`
  const deleted = scope.type === 'post' ? result.posts : result.comments

  // 管理后台变更由 zz-admin-guard 中间件统一兜底记录，
  // 这里额外写一条带动作、范围与结果数量的记录，便于审计检索「彻底删除归档」
  await writeAdminAudit(event, {
    action: 'COMMUNITY_ARCHIVE_PURGE',
    target: `社区归档${label}`,
    detail: `彻底删除归档${label}：${mode}；实际删除 ${deleted} 条，剩余 ${result.remaining} 条`
  })

  return { success: true, ...result }
})

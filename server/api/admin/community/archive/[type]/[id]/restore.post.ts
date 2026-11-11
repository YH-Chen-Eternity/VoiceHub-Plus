import { getRouterParam } from 'h3'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { restoreArchivedCommunityContent } from '~~/server/utils/communityArchive'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'

/**
 * 管理后台「社区归档记录」恢复/撤回归档。
 * POST /api/admin/community/archive/:type/:id/restore，type 支持 post/posts/comment/comments。
 * 鉴权：仅管理员/超级管理员（2026-11-11：归档记录整体从审帖员视野收回，恢复操作同口径）。
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityAdmin(event)

  const typeParam = String(getRouterParam(event, 'type') || '').trim()
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError(400, 'COMMUNITY_ARCHIVE_INVALID', '归档记录参数不正确')
  }

  const result = await restoreArchivedCommunityContent({ type: typeParam, id, actor: user })
  const label = result.type === 'post' ? '帖子' : '评论'
  const detail =
    result.type === 'post'
      ? `从归档恢复社区帖子（作者用户 #${result.post.authorId}，板块 #${result.post.boardId}）`
      : `从归档恢复社区评论（作者用户 #${result.comment.authorId}，所属帖子 #${result.comment.postId}）`

  // 管理审计：管理后台变更由 zz-admin-guard 中间件统一兜底记录，
  // 这里额外写一条带明确动作与目标的记录，便于在审计日志中检索“恢复归档”操作
  await writeAdminAudit(event, {
    action: 'COMMUNITY_ARCHIVE_RESTORE',
    target: `社区${label} #${id}`,
    detail
  })

  return result
})

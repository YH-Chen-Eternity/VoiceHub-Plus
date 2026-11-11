import { getQuery } from 'h3'
import {
  getCommunitySettings,
  getCommunityViewer,
  getGuestVisibleBoardIds,
  isCommunityAdmin,
  isCommunityGuest,
  isCommunityReviewer
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { loadCommunityPosts } from '~~/server/utils/communityFeed'

export default defineEventHandler(async (event) => {
  const user = getCommunityViewer(event)
  const guest = isCommunityGuest(event)
  const settings = await getCommunitySettings()
  if (!settings.enabled && !isCommunityReviewer(user)) {
    throw createApiError(403, 'COMMUNITY_DISABLED', '回声社区暂未开放')
  }

  const query = getQuery(event)
  const boardId = Number(query.boardId || 0) || undefined
  const beforeId = Number(query.beforeId || 0) || undefined
  const limit = Math.min(Math.max(Number(query.limit || 20) || 20, 1), 30)
  // 游客无论如何都只能看「已通过」的公开信息流：禁止 mine 参数把 status 放宽到全部
  const mine = !guest && (query.mine === '1' || query.mine === 'true')
  const q = String(query.q || '').trim().slice(0, 50)
  const sort = query.sort === 'hot' ? 'hot' : 'latest'

  // 游客只能看到管理员开启「游客可见」的板块；boardId 参数与白名单取交集，
  // 防止用 boardId 把可见范围放大到禁看板块。空数组时 loadCommunityPosts 会返回空集。
  const guestBoardIds = guest ? await getGuestVisibleBoardIds() : undefined

  const posts = await loadCommunityPosts({
    viewerId: user.id,
    viewerRole: user.role,
    boardId,
    boardIds: guestBoardIds,
    // 最热排序不支持游标翻页，只返回第一页（前端在热门模式隐藏“加载更多”）
    beforeId: sort === 'hot' ? undefined : beforeId,
    limit,
    status: mine ? undefined : 'APPROVED',
    authorId: mine ? user.id : undefined,
    q: q || undefined,
    sort,
    viewerIsAdmin: isCommunityAdmin(user)
  })

  return {
    success: true,
    posts,
    nextCursor:
      sort === 'latest' && posts.length === limit ? posts[posts.length - 1]?.id ?? null : null,
    permissions: {
      // 管理员可在信息流直接置顶/取消置顶
      canPin: isCommunityAdmin(user)
    }
  }
})

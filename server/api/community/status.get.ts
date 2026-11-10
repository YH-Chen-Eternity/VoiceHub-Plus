import {
  getCommunitySettings,
  getCommunityViewer,
  getReviewableBoardIds,
  isCommunityAdmin,
  isCommunityGuest,
  isCommunityReviewer,
  resolveCommunityBanState,
  toPublicCommunitySettings,
  ensureCommunityProfile
} from '~~/server/utils/community'

export default defineEventHandler(async (event) => {
  const settings = await getCommunitySettings()

  // 游客只读：返回匿名 viewer，绝不调用 ensureCommunityProfile（会给不存在的 userId=0 写脏档案）
  if (isCommunityGuest(event)) {
    return {
      success: true,
      settings: toPublicCommunitySettings(settings),
      viewer: {
        id: 0,
        canReview: false,
        isCommunityAdmin: false,
        reviewBoardIds: [] as number[] | null,
        ban: { muted: false, permanent: false, until: null, reason: null },
        violationCount: 0
      }
    }
  }

  const user = getCommunityViewer(event)
  const profile = await ensureCommunityProfile(user.id)
  const reviewBoardIds = await getReviewableBoardIds(user)

  return {
    success: true,
    settings: toPublicCommunitySettings(settings),
    viewer: {
      id: user.id,
      canReview:
        isCommunityReviewer(user) &&
        (isCommunityAdmin(user) || (reviewBoardIds?.length ?? 0) > 0),
      isCommunityAdmin: isCommunityAdmin(user),
      reviewBoardIds,
      ban: resolveCommunityBanState(profile),
      violationCount: profile.violationCount
    }
  }
})

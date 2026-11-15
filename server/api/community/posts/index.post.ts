import { randomUUID } from 'node:crypto'
import { readBody } from 'h3'
import { and, eq, gte, inArray, isNull } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPostImages, communityPosts, mediaAssets, songs } from '~/drizzle/schema'
import {
  assertCommunityNotMuted,
  getBoardOrThrow,
  isCommunityRateLimitExempt,
  requireCommunityUser,
  requireCommunityEnabled,
  type CommunitySettingsRow
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'
import { signMediaToken } from '~~/server/utils/mediaToken'
import { checkSongBlacklist } from '~~/server/utils/songBlacklistMatch'
import { getServerTimestamp } from '~~/server/utils/serverTime'
import { moderateCommunityImage, moderateCommunityText } from '~~/server/utils/communityModeration'
import {
  isCommunityModerationServiceConfigured,
  moderateCommunityPostWithService
} from '~~/server/utils/communityModerationService'
import {
  computePostHash,
  mapWithConcurrency,
  resolveImagesPerPost,
  splitImageGroups,
  summarizeBatchStatus,
  validatePostInput,
  IMAGE_MODERATION_CONCURRENCY,
  MODERATION_CONCURRENCY
} from '~~/server/utils/communityPostBatch'

function cleanText(input: unknown): string {
  // 剔除不可见控制字符（保留 \t \n \r）
  return Array.from(String(input ?? ''))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return !(code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31))
    })
    .join('')
    .trim()
}

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

// 待审图片不在公开引用中，审核链路需要带短期签名才能读取
function mediaUrl(origin: string, imageId: number): string {
  const token = signMediaToken(imageId)
  return `${origin}/api/media/${imageId}${token ? `?mt=${encodeURIComponent(token)}` : ''}`
}

type PostModeration = {
  status: string
  moderationLabel: string | null
  moderationDetail: string | null
}

type TextModeration = Awaited<ReturnType<typeof moderateCommunityText>>
type ImageModeration = Awaited<ReturnType<typeof moderateCommunityImage>>

const PASSIVE_TEXT_MODERATION: TextModeration = {
  provider: 'none',
  hit: false,
  labels: [],
  detail: null,
  error: null
}

/**
 * 构造整批共用的审核器。一次发布的所有帖子文案相同，图片集合是同一批，
 * 因此文本审核只调用一次、每张图片只审核一次，结果在各帖之间复用。
 * 独立审核服务按帖调用（其入参以帖为单位，且单帖图片数天然不超过上限）。
 */
function buildModerationResolver(params: {
  content: string
  settings: CommunitySettingsRow
  publicOrigin: string
  userId: number
}) {
  const { content, settings, publicOrigin, userId } = params
  const useService = settings.moderationEnabled && isCommunityModerationServiceConfigured()
  const hasAliyunCredentials = Boolean(settings.aliyunAccessKeyId && settings.aliyunAccessKeySecret)

  let textPromise: Promise<TextModeration> | null = null
  const textModeration = (): Promise<TextModeration> => {
    if (!content) return Promise.resolve(PASSIVE_TEXT_MODERATION)
    if (!textPromise) textPromise = moderateCommunityText(content, settings)
    return textPromise
  }

  const imageCache = new Map<number, Promise<ImageModeration>>()
  const imageModeration = (imageId: number): Promise<ImageModeration> => {
    let pending = imageCache.get(imageId)
    if (!pending) {
      pending = moderateCommunityImage(mediaUrl(publicOrigin, imageId), settings)
      imageCache.set(imageId, pending)
    }
    return pending
  }

  return async (group: number[], groupIndex: number): Promise<PostModeration> => {
    if (useService) {
      const imageUrls =
        publicOrigin && settings.allowImages && group.length > 0
          ? group.map((imageId) => mediaUrl(publicOrigin, imageId))
          : []
      const result = await moderateCommunityPostWithService({
        // 帖子尚未入库，使用带用户、随机后缀与组序号的临时业务 ID 做审核链路追踪
        postId: `community-${userId}-${Date.now()}-${randomUUID().slice(0, 8)}-${groupIndex}`,
        text: content,
        imageUrls,
        settings
      })
      return {
        status: result.postStatus,
        moderationLabel: result.label,
        moderationDetail: result.detail
      }
    }

    // 未配置独立审核服务：直连阿里云审核。
    // 处置口径（站长设定）：中风险及以上转人工，低风险及以下自动放行；
    // 审核接口异常、未配置密钥、图片无法校验时一律转人工，宁可多审不可漏审。
    let needsManualReview = !settings.moderationEnabled || !hasAliyunCredentials
    let status = 'PENDING'
    let moderationLabel: string | null = null
    let moderationDetail: string | null = null

    const moderation = await textModeration()
    if (moderation.error) needsManualReview = true
    if (moderation.hit) {
      needsManualReview = true
      moderationLabel = moderation.labels.join(',') || 'RISK'
      moderationDetail = moderation.detail
      if (settings.moderationHitAction === 'BLOCK') status = 'BLOCKED'
    }

    if (!needsManualReview && settings.allowImages && group.length > 0) {
      if (!publicOrigin) {
        needsManualReview = true
      } else {
        const results = await mapWithConcurrency(group, IMAGE_MODERATION_CONCURRENCY, (imageId) =>
          imageModeration(imageId)
        )
        for (const result of results) {
          if (result.error) needsManualReview = true
          if (result.hit) {
            needsManualReview = true
            moderationLabel = [moderationLabel, result.labels.join(',')].filter(Boolean).join(',')
            moderationDetail = [moderationDetail, result.detail].filter(Boolean).join('；')
            if (settings.moderationHitAction === 'BLOCK') status = 'BLOCKED'
          }
        }
      }
    }

    if (!needsManualReview) status = 'APPROVED'
    return { status, moderationLabel, moderationDetail }
  }
}

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await requireCommunityEnabled()
  await assertCommunityNotMuted(user.id)

  if (user.status && user.status !== 'active') {
    throw createApiError(403, 'COMMUNITY_ACCOUNT_UNAVAILABLE', '账号状态异常，无法发帖')
  }

  // 发稿员（CONTRIBUTOR）豁免频率限流；禁言/查重/审核/内容校验一律保留。
  // 批量发布是一次请求，这里整批只计一次额度。
  if (!isCommunityRateLimitExempt(user)) {
    const minuteLimit = await checkDistributedRateLimit(
      `community_post:user:${user.id}`,
      10,
      60 * 1000
    )
    const dayLimit = await checkDistributedRateLimit(
      `community_post_day:user:${user.id}`,
      50,
      24 * 60 * 60 * 1000
    )
    if (!minuteLimit.isAllowed || !dayLimit.isAllowed) {
      throw createApiError(
        429,
        SERVER_ERROR_CODES.COMMON_RATE_LIMITED_SECONDS,
        '发帖过于频繁，请稍后重试'
      )
    }
  }

  const body = await readBody(event)
  // 显示模式：semi(默认/半实名) / real(实名) / anon(匿名)。
  // 校验后台三开关，非法值或对应开关关闭一律回退 semi；anon 帖强制走人工审核。
  const requestedNameMode = String(body?.nameMode ?? '').trim()
  let nameMode = 'semi'
  if (requestedNameMode === 'real' && settings.allowRealname !== false) nameMode = 'real'
  else if (requestedNameMode === 'anon' && settings.allowAnonymous !== false) nameMode = 'anon'
  else if (requestedNameMode === 'semi' && settings.allowSemi !== false) nameMode = 'semi'

  const boardId = Number(body?.boardId)
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw createApiError(400, 'COMMUNITY_BOARD_REQUIRED', '请选择板块')
  }
  const board = await getBoardOrThrow(boardId)
  if (!board.isActive) {
    throw createApiError(400, 'COMMUNITY_BOARD_CLOSED', '该板块已关闭')
  }

  const content = cleanText(body?.content)
  const rawImageIds = Array.isArray(body?.imageIds) ? body.imageIds : []
  const imageIds = Array.from(
    new Set(
      rawImageIds
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isInteger(id) && id > 0)
    )
  ) as number[]

  // 正文与图片至少其一：允许纯文字帖，也允许纯图帖
  const inputError = validatePostInput(content, imageIds.length, settings.maxContentLength)
  if (inputError === 'COMMUNITY_CONTENT_REQUIRED') {
    throw createApiError(400, inputError, '写点什么或添加图片再发布吧')
  }
  if (inputError === 'COMMUNITY_CONTENT_TOO_LONG') {
    throw createApiError(400, inputError, `内容不能超过 ${settings.maxContentLength} 字`, {
      params: [settings.maxContentLength]
    })
  }

  // 批量开关关闭时沿用单帖上限；开启时按每帖图片数把整批切成若干组，组数不设上限
  if (imageIds.length > 0 && !settings.allowImages) {
    throw createApiError(400, 'COMMUNITY_IMAGES_DISABLED', '当前不允许发布图片')
  }
  const imagesPerPost = resolveImagesPerPost(settings.maxImages)
  const batchEnabled = settings.allowMultiImageBatch === true
  if (!batchEnabled && imageIds.length > imagesPerPost) {
    throw createApiError(
      400,
      'COMMUNITY_TOO_MANY_IMAGES',
      `最多只能上传 ${imagesPerPost} 张图片`,
      { params: [imagesPerPost] }
    )
  }
  const groups = splitImageGroups(imageIds, imagesPerPost)

  if (imageIds.length > 0) {
    const owned = await db
      .select({ id: mediaAssets.id, mimeType: mediaAssets.mimeType })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, imageIds), eq(mediaAssets.uploadedBy, user.id)))
    if (owned.length !== imageIds.length) {
      throw createApiError(400, 'COMMUNITY_IMAGE_INVALID', '图片无效，请重新上传')
    }
    if (owned.some((item) => !String(item.mimeType).startsWith('image/'))) {
      throw createApiError(400, 'COMMUNITY_IMAGE_INVALID', '图片格式不正确')
    }
  }

  // 同作者 10 分钟内相同内容视为重复发帖；在调用付费审核接口前拦截。
  // 整批视为一次发布，用整批指纹统一判重；批次内各帖共享该指纹，互不干扰。
  const batchHash = computePostHash(content, imageIds)
  const duplicateSince = new Date(getServerTimestamp() - DUPLICATE_WINDOW_MS)
  const [duplicatePost] = await db
    .select({ id: communityPosts.id })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.authorId, user.id),
        eq(communityPosts.contentHash, batchHash),
        gte(communityPosts.createdAt, duplicateSince),
        isNull(communityPosts.deletedAt)
      )
    )
    .limit(1)
  if (duplicatePost) {
    throw createApiError(
      400,
      'COMMUNITY_POST_DUPLICATE',
      '内容与最近 10 分钟内发布的帖子重复，请勿重复发帖'
    )
  }

  let songId: number | null = null
  if (body?.songId != null && body.songId !== '') {
    const parsed = Number(body.songId)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw createApiError(400, 'COMMUNITY_SONG_INVALID', '歌曲参数不正确')
    }
    // 选歌只要求「已投稿」：往期、已播放、已排期的歌曲都能附到帖子。
    // 但命中黑名单的歌曲不允许附上去（含语种/曲风，与投稿时共用同一套后台配置规则）
    const song = await db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        musicPlatform: songs.musicPlatform,
        musicId: songs.musicId
      })
      .from(songs)
      .where(eq(songs.id, parsed))
      .limit(1)
    if (!song[0]) throw createApiError(404, 'SONG_NOT_FOUND', '歌曲不存在')

    const blacklistResult = await checkSongBlacklist({
      title: song[0].title,
      artist: song[0].artist,
      musicPlatform: song[0].musicPlatform,
      musicId: song[0].musicId
    })
    if (blacklistResult.isBlocked) {
      throw createApiError(
        400,
        'SONG_BLACKLISTED',
        blacklistResult.reasons[0]?.reason || '该歌曲已被加入黑名单'
      )
    }
    songId = parsed
  }

  const publicOrigin = String(process.env.COMMUNITY_PUBLIC_ORIGIN || '').replace(/\/$/, '')
  const resolveModeration = buildModerationResolver({
    content,
    settings,
    publicOrigin,
    userId: user.id
  })
  const moderations = await mapWithConcurrency(groups, MODERATION_CONCURRENCY, (group, index) =>
    resolveModeration(group, index)
  )
  // 匿名帖强制人工审核：忽略自动放行（免审）路径，但保留 BLOCKED 等安全拦截结果
  for (const moderation of moderations) {
    if (nameMode === 'anon' && moderation.status === 'APPROVED') moderation.status = 'PENDING'
  }

  // 整批在一个事务内建帖：任一组失败则全部回滚，不会出现只发出前半批
  const created = await db.transaction(async (tx) => {
    const rows: { id: number; status: string }[] = []
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index]!
      const moderation = moderations[index]!
      const [post] = await tx
        .insert(communityPosts)
        .values({
          boardId,
          authorId: user.id,
          content,
          contentHash: batchHash,
          songId,
          nameMode,
          status: moderation.status,
          moderationLabel: moderation.moderationLabel,
          moderationDetail: moderation.moderationDetail
        })
        .returning({ id: communityPosts.id, status: communityPosts.status })

      if (group.length > 0) {
        await tx.insert(communityPostImages).values(
          group.map((mediaId, sortOrder) => ({
            postId: post!.id,
            mediaId,
            sortOrder
          }))
        )
      }
      rows.push(post!)
    }
    return rows
  })

  const status = summarizeBatchStatus(created.map((post) => post.status))
  const count = created.length
  const message =
    status === 'BLOCKED'
      ? '内容未通过安全审核，已被拦截'
      : count > 1
        ? status === 'APPROVED'
          ? `已发布 ${count} 个帖子`
          : `已提交 ${count} 个帖子，审核通过后会出现在回声社区`
        : status === 'APPROVED'
          ? '发布成功'
          : '发布成功，审核通过后会出现在回声社区'

  return {
    success: true,
    id: created[0]!.id,
    ids: created.map((post) => post.id),
    count,
    batched: count > 1,
    status,
    nameMode,
    message
  }
})

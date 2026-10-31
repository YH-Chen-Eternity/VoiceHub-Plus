/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { createApiError } from '~~/server/utils/apiError'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'
import { getTxSongPlayableInfo, upgradeTxAudioUrl } from '~~/server/utils/native_tx'
import { buildRedisKey, getRedisClient, isRedisConfigured } from '~~/server/utils/redis'
import {
  getQqCookieDiagnostic,
  normalizeQqCookie,
  refreshQqCredential,
  resolveQqOfficialPlayUrl,
  resolveQqSdkPlayUrl
} from '~~/server/utils/qq_music_sdk'

// 第三方解析源凭据一律从环境变量读取，不在代码中硬编码（2026-10-23 安全加固：
// 原实现把付费卡密/API Key 明文写在源码中，仓库泄露即被盗刷；未配置时该源自动禁用）
const HYW_TX_URL = process.env.MUSIC_HYW_TX_URL || 'http://103.79.184.97/api/music/url'
const YUAFENG_TX_URL = process.env.MUSIC_YUAFENG_TX_URL || 'https://api-v2.yuafeng.cn/API/qqmusic.php'
const HELLOWORLD_TX_URL = 'https://a.aa.cab/qq.music'
// QQ 已知无效占位音频，命中说明源返回的是错误录音
const INVALID_QQ_AUDIO_URL_SUFFIX = '/2149972737147268278.mp3'

const getHywCardKey = (): string => String(process.env.MUSIC_HYW_CARD_KEY || '').trim()
const getYuafengApiKey = (): string => String(process.env.MUSIC_YUAFENG_APIKEY || '').trim()

// 从任意 JSON/文本响应中防御式提取 QQ 音频直链
const extractTxAudioUrl = (payload: unknown): string => {
  let found = ''
  const visit = (node: any) => {
    if (found || !node) return
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node) && (/vkey=/i.test(node) || /\.(mp3|flac|m4a|ape|wav)(\?|$)/i.test(node))) {
        found = node.trim()
      }
      return
    }
    if (typeof node === 'object') Object.values(node).forEach(visit)
  }
  visit(payload)
  return found
}

const isValidTxAudioUrl = (url: string) => /^https?:\/\//i.test(url) && !url.includes(INVALID_QQ_AUDIO_URL_SUFFIX)

const resolveTxWithHyw = async (songmid: string, quality: unknown) => {
  const cardKey = getHywCardKey()
  if (!cardKey) throw new Error('HYW 源未配置（MUSIC_HYW_CARD_KEY），已跳过')
  const qualityMap: Record<string, string> = {
    '4': '128k',
    '8': '320k',
    '10': 'flac',
    '11': 'master',
    '14': 'master'
  }
  const query = new URLSearchParams({
    source: 'tx',
    songId: songmid,
    songmid,
    platform: 'tx',
    quality: qualityMap[String(quality)] || String(quality || '128k'),
    key: cardKey
  })
  const response = await fetch(`${HYW_TX_URL}?${query.toString()}`, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json', 'X-Card-Key': cardKey }
  })
  if (!response.ok) throw new Error(`HYW 返回 ${response.status}`)
  const data: any = await response.json()
  const url = typeof data?.url === 'string' ? data.url.trim() : ''
  if (data?.code !== 200 || !/^https?:\/\//i.test(url)) {
    throw new Error(data?.message || 'HYW 未返回播放链接')
  }
  return upgradeTxAudioUrl(url)
}

const resolveTxWithYuafeng = async (songmid: string, quality: unknown) => {
  const apiKey = getYuafengApiKey()
  if (!apiKey) throw new Error('玉宁熙源未配置（MUSIC_YUAFENG_APIKEY），已跳过')
  const typeMap: Record<string, string> = {
    '4': '标准',
    '8': '高品质',
    '10': '无损',
    '11': '无损',
    '14': '无损'
  }
  const url = `${YUAFENG_TX_URL}?type=${encodeURIComponent(typeMap[String(quality)] || '标准')}&mid=${encodeURIComponent(songmid)}&apikey=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`玉宁熙返回 ${response.status}`)
  const text = await response.text()
  let payload: any = text
  try { payload = JSON.parse(text) } catch { /* 非 JSON 响应，按原始文本提取 */ }
  const playUrl = extractTxAudioUrl(payload)
  if (!isValidTxAudioUrl(playUrl)) throw new Error('玉宁熙未返回播放链接')
  return upgradeTxAudioUrl(playUrl)
}

const resolveTxWithHelloWorld = async (name: string) => {
  if (!name) throw new Error('HelloWorld 缺少歌曲名')
  const url = `${HELLOWORLD_TX_URL}?msg=${encodeURIComponent(name)}&n=1&type=0`
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  if (!response.ok) throw new Error(`HelloWorld 返回 ${response.status}`)
  const text = await response.text()
  let payload: any = text
  try { payload = JSON.parse(text) } catch { /* 非 JSON 响应，按原始文本提取 */ }
  const playUrl = extractTxAudioUrl(payload)
  if (!isValidTxAudioUrl(playUrl)) throw new Error('HelloWorld 未返回播放链接')
  return upgradeTxAudioUrl(playUrl)
}

// ---------------------------------------------------------------------------
// 解析结果缓存（跨实例共享，2026-10-31 优化）
// 背景：同一首歌在高峰期会被反复解析，每次都真实打上游接口；上游偶发 500 时
// 直接以 502 抛给前端，表现为「歌放不出来」。这里做三件事：
//   1. 结果缓存：匿名链路的解析结果按歌缓存，命中就不再打上游
//   2. 并发合并：同一首歌的并发请求合并成一个上游调用
//   3. 多源降级：单源失败时自动尝试其它源，而不是直接 502
// 安全约束：带用户登录态的结果（含 cookie / 私有 VIP 直链）一律不进共享缓存
// ---------------------------------------------------------------------------
const RESOLVE_CACHE_TTL_SECONDS = 45 * 60

type MusicResolveResult = {
  success: boolean
  url: string
  source: string
  normalizedMusicId: string
  idType: string
  authUsed: boolean
  authDiagnostic: unknown
  cached?: boolean
  cookie?: string
}

// 进程内 in-flight 去重：同一首歌的并发解析共用一个上游请求
const inFlightResolves = new Map<string, Promise<MusicResolveResult>>()

const readResolveCache = async (key: string): Promise<MusicResolveResult | null> => {
  try {
    if (!isRedisConfigured()) return null
    const client = await getRedisClient()
    if (!client) return null
    const raw = await client.get(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.url !== 'string' || !parsed.url) return null
    // 缓存只存匿名链路结果，读出时再剔除一次登录态字段，双保险
    const { cookie: _omit, ...safe } = parsed
    return { ...safe, cached: true } as MusicResolveResult
  } catch {
    return null
  }
}

const writeResolveCache = async (key: string, value: MusicResolveResult) => {
  try {
    if (!isRedisConfigured()) return
    const client = await getRedisClient()
    if (!client) return
    // 登录态结果不进共享缓存
    if (value.cookie) return
    const { cached: _omit, ...payload } = value
    await client.set(key, JSON.stringify(payload), { EX: RESOLVE_CACHE_TTL_SECONDS })
  } catch {
    // 缓存写入失败不影响主流程
  }
}

export default defineEventHandler(async (event) => {
  const rateLimit = await checkDistributedRateLimit(
    `music_resolve_url:${getClientIP(event)}`,
    600,
    60 * 1000
  )
  if (!rateLimit.isAllowed) {
    throw createApiError(
      429,
      SERVER_ERROR_CODES.COMMON_RATE_LIMITED_SECONDS,
      '解析请求过于频繁，请稍后重试'
    )
  }

  const body = await readBody(event)
  const platform = String(body?.platform || '').trim()
  const musicId = body?.musicId
  const playUrl = String(body?.playUrl || '').trim()
  const cookie = normalizeQqCookie(String(body?.cookie || '').trim())
  // official-first：QQ 官方 Cookie 链路；aggregator：内置聚合源兜底链；fallback：第三方兜底链路
  const rawStrategy = String(body?.strategy || '')
  const strategy =
    rawStrategy === 'official-first' ? 'official-first' : rawStrategy === 'aggregator' ? 'aggregator' : 'fallback'
  const excludedSources = new Set(
    Array.isArray(body?.excludeSources)
      ? body.excludeSources.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : []
  )

  if (playUrl) {
    return {
      success: true,
      url: platform === 'tencent' ? upgradeTxAudioUrl(playUrl) : playUrl,
      source: 'play-url',
      normalizedMusicId: musicId ? String(musicId).trim() : '',
      idType: 'provided-url',
      authUsed: Boolean(cookie),
      authDiagnostic: getQqCookieDiagnostic(cookie)
    }
  }

  if (platform !== 'tencent') {
    throw createError({ statusCode: 400, message: '暂不支持的平台' })
  }

  const normalizedMusicId = String(musicId || '').trim()
  const songName = String(body?.name || '').trim()

  // 缓存仅用于匿名链路：带登录态时结果与用户绑定（VIP 音质/私有直链），不可共享
  const cacheable = !cookie
  const cacheKey = cacheable
    ? buildRedisKey(
        'musicres',
        platform,
        normalizedMusicId,
        strategy,
        String(body?.quality ?? ''),
        String(body?.mediaId ?? ''),
        songName,
        Array.from(excludedSources).sort().join(',')
      )
    : ''

  if (cacheKey) {
    const cached = await readResolveCache(cacheKey)
    if (cached) return cached
  }

  const buildResponse = (
    url: string,
    source: string,
    resolvedId: string,
    idType: string,
    authUsed: boolean,
    activeCookie?: string
  ): MusicResolveResult => {
    const response: MusicResolveResult = {
      success: true,
      url,
      source,
      normalizedMusicId: resolvedId,
      idType,
      authUsed,
      authDiagnostic: getQqCookieDiagnostic(activeCookie || cookie)
    }
    if (activeCookie) response.cookie = activeCookie
    return response
  }

  const runResolve = async (): Promise<MusicResolveResult> => {
    // 官方与第三方取链均要求字母 songmid；历史数字 songId 先解析为 MID，避免原样透传导致取链失败
    let resolvedMusicId = normalizedMusicId
    let resolvedMediaId = String(body?.mediaId || '').trim() || undefined
    if (/^\d+$/.test(normalizedMusicId)) {
      try {
        const playable = await getTxSongPlayableInfo(normalizedMusicId)
        resolvedMusicId = playable.songmid
        if (!resolvedMediaId && playable.strMediaMid) resolvedMediaId = playable.strMediaMid
      } catch (error: any) {
        console.warn('[music/resolve-url] QQ 数字 songId 解析 MID 失败:', error?.message || error)
        throw createError({ statusCode: 502, message: 'QQ 音乐播放链接解析失败' })
      }
    }

    // 聚合源兜底链：玉宁熙（按 mid）→ HelloWorld（按歌名）→ HYW，统一走后端以规避前端 CORS
    if (strategy === 'aggregator') {
      const attempts: Array<{ id: string; run: () => Promise<string> }> = []
      if (!excludedSources.has('yuafeng-tx')) {
        attempts.push({ id: 'yuafeng-tx', run: () => resolveTxWithYuafeng(resolvedMusicId, body?.quality) })
      }
      if (!excludedSources.has('helloworld-tx') && songName) {
        attempts.push({ id: 'helloworld-tx', run: () => resolveTxWithHelloWorld(songName) })
      }
      if (!excludedSources.has('hyw-tx')) {
        attempts.push({ id: 'hyw-tx', run: () => resolveTxWithHyw(resolvedMusicId, body?.quality) })
      }

      let lastError = ''
      for (const attempt of attempts) {
        try {
          const url = await attempt.run()
          return buildResponse(url, attempt.id, resolvedMusicId, 'songmid', false)
        } catch (error: any) {
          lastError = error?.message || String(error)
          console.warn(`[music/resolve-url] ${attempt.id} 解析失败:`, lastError)
        }
      }
      throw createError({
        statusCode: 502,
        message: lastError ? `QQ 聚合源解析失败：${lastError}` : 'QQ 聚合源解析失败'
      })
    }

    // 官方 Cookie 链路：带用户登录态走 CgiGetVkey，可获取 VIP/高音质直链
    if (strategy === 'official-first') {
      if (excludedSources.has('qq-official')) {
        throw createError({ statusCode: 502, message: 'QQ 音乐播放链接解析失败' })
      }

      const mediaId = resolvedMediaId

      // SDK 与原生直连互为校验：SDK 依赖上游文件名策略，原生链路可诊断拒绝原因
      const attemptOfficial = async (activeCookie?: string): Promise<string> => {
        try {
          return await resolveQqSdkPlayUrl(resolvedMusicId, body?.quality, activeCookie, mediaId)
        } catch (error: any) {
          const sdkError = error?.message || String(error)
          console.warn('[music/resolve-url] QQ 官方 SDK 解析失败，尝试原生直连:', sdkError)

          try {
            return await resolveQqOfficialPlayUrl({
              songmid: resolvedMusicId,
              quality: body?.quality,
              cookie: activeCookie,
              mediaId
            })
          } catch (nativeError: any) {
            const nativeErrorText = nativeError?.message || String(nativeError)
            console.warn('[music/resolve-url] QQ 原生直连解析失败:', nativeErrorText)
            throw createError({
              statusCode: 502,
              message: `QQ 官方链路解析失败：${sdkError}；原生直连：${nativeErrorText}`
            })
          }
        }
      }

      let activeCookie = cookie || undefined
      try {
        const url = await attemptOfficial(activeCookie)
        return buildResponse(url, 'qq-official', resolvedMusicId, 'songmid', Boolean(activeCookie))
      } catch (error: any) {
        // 登录态过期是解析失败的常见原因，续期成功后重试一轮
        if (!activeCookie) throw error
        const refreshResult = await refreshQqCredential({ cookie: activeCookie })
        if (!refreshResult.refreshed) throw error
        activeCookie = refreshResult.cookie

        const url = await attemptOfficial(activeCookie)
        return buildResponse(url, 'qq-official', resolvedMusicId, 'songmid', true, activeCookie)
      }
    }

    // 第三方兜底链：HYW → 玉宁熙 → HelloWorld，任一成功即返回（原实现只有 HYW 一个源，
    // 上游偶发 500 时直接 502，这里补上后续源，避免单源故障就让用户听不了歌）
    const fallbackAttempts: Array<{ id: string; run: () => Promise<string> }> = []
    if (!excludedSources.has('hyw-tx')) {
      fallbackAttempts.push({ id: 'hyw-tx', run: () => resolveTxWithHyw(resolvedMusicId, body?.quality) })
    }
    if (!excludedSources.has('yuafeng-tx')) {
      fallbackAttempts.push({ id: 'yuafeng-tx', run: () => resolveTxWithYuafeng(resolvedMusicId, body?.quality) })
    }
    if (!excludedSources.has('helloworld-tx') && songName) {
      fallbackAttempts.push({ id: 'helloworld-tx', run: () => resolveTxWithHelloWorld(songName) })
    }

    let lastFallbackError = ''
    for (const attempt of fallbackAttempts) {
      try {
        const url = await attempt.run()
        return buildResponse(url, attempt.id, resolvedMusicId, 'songmid', Boolean(cookie))
      } catch (error: any) {
        lastFallbackError = error?.message || String(error)
        console.warn(`[music/resolve-url] ${attempt.id} 解析失败:`, lastFallbackError)
      }
    }

    throw createError({
      statusCode: 502,
      message: lastFallbackError ? `QQ 音乐播放链接解析失败：${lastFallbackError}` : 'QQ 音乐播放链接解析失败'
    })
  }

  // 并发合并：同一首歌的并发请求共用一个上游调用，避免瞬间打爆上游
  if (cacheKey && inFlightResolves.has(cacheKey)) {
    try {
      const shared = await inFlightResolves.get(cacheKey)!
      return { ...shared, cached: true }
    } catch (error) {
      throw error
    }
  }

  const resolvePromise = runResolve()
  if (cacheKey) inFlightResolves.set(cacheKey, resolvePromise)

  let result: MusicResolveResult
  try {
    result = await resolvePromise
  } finally {
    if (cacheKey) inFlightResolves.delete(cacheKey)
  }

  if (cacheKey && !result.cookie) {
    await writeResolveCache(cacheKey, result)
  }

  return result
})

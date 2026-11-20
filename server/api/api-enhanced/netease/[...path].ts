// Modified by YH-Chen on 2026-10-17
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildRedisKey, getRedisClient } from '~~/server/utils/redis'
import { getServerTimestamp } from '~~/server/utils/serverTime'
import { getClientIP } from '~~/server/utils/ip-utils'
import {
  isNeteaseRealIpEnabled,
  resolveNeteaseOutboundIp
} from '~~/server/utils/neteaseRealIp'

const neteaseEnhancedApiPromise = import('@neteasecloudmusicapienhanced/api').then((mod) => {
  return (mod.default || {}) as Record<string, (params: Record<string, any>) => Promise<any>>
})

// 上游 SDK 自身不设超时，一次挂起会长期占住云函数实例（Pages 上会放大成整站 504），故加整体截止时间
const NETEASE_CALL_TIMEOUT_MS = 12000
// xeapi 公钥预热同样可能挂起，且模块级 promise 被所有请求共用，必须单独封顶
const NETEASE_CONFIG_TIMEOUT_MS = 5000

async function withDeadline<T>(task: Promise<T>, ms: number, endpoint: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(createError({
          statusCode: 504,
          message: `网易云接口 ${endpoint} 调用超时`
        })), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// 网易云接口白名单：只放行应用实际调用的端点（端点路径 → 允许的 HTTP 方法）
// 未列入的接口一律 403；新增或变更调用端点时必须同步此表（见 AGENTS.md 4.9）
const allowedEndpoints = new Map<string, Set<string>>([
  // 搜索 / 详情 / 封面 / 歌词 / 播放链接
  ['cloudsearch', new Set(['GET'])],
  ['search', new Set(['GET'])],
  ['song/detail', new Set(['GET'])],
  ['song/url/v1', new Set(['GET'])],
  ['album', new Set(['GET'])],
  ['lyric', new Set(['GET'])],
  ['lyric/new', new Set(['GET'])],
  // 听歌识曲（音频指纹走请求体，仅 POST）
  ['audio/match', new Set(['POST'])],
  // 评论
  ['comment/music', new Set(['GET'])],
  ['comment/like', new Set(['GET'])],
  // 扫码登录
  ['login/qr/key', new Set(['GET'])],
  ['login/qr/create', new Set(['GET'])],
  ['login/qr/check', new Set(['GET'])],
  ['login/status', new Set(['GET', 'POST'])],
  // 账号歌单
  ['user/playlist', new Set(['GET'])],
  ['playlist/create', new Set(['GET'])],
  ['playlist/delete', new Set(['GET'])],
  ['playlist/tracks', new Set(['GET'])],
  ['playlist/detail', new Set(['GET'])],
  ['playlist/track/all', new Set(['GET'])],
  // 播放记录 / 听歌上报
  ['record/recent/song', new Set(['GET'])],
  ['scrobble/v1', new Set(['GET'])],
  // 云盘上传（文件本体由客户端直传，仅令牌与完成回调经服务端）
  ['cloud/upload/token', new Set(['POST'])],
  ['cloud/upload/complete', new Set(['POST'])]
])

// xeapi 公钥缓存文件路径（由 generateConfig 写入系统临时目录）
const xeapiPublicKeyPath = join(tmpdir(), 'xeapi_public_key')

// 扫码登录结果暂存（发起方 + unikey → cookie），用于 803 响应丢失后的补发。
// 该路由匿名可达，unikey 又出现在二维码内容里，若只按 unikey 回放，任何拿到该 key
// 的客户端都能兑换 cookie，等于把一次性的 803 延长成 5 分钟窗口。因此条目与发起方
// 绑定：qr/key 下发随机 owner cookie，check 时校验一致才回放。
const QR_LOGIN_TTL_SECONDS = 5 * 60
// 803 补发窗口。前端在 803 响应丢失后会补查两次（1.2s×2），再加一轮 3s 轮询，
// 10s 已足够覆盖正常抖动；给到 60s 是为了慢网络冗余。缓存本身仍保留 5 分钟
// （多实例兜底 / 同一浏览器重开），但超过该窗口的记录不再回放，避免把
// 「一次性的登录凭证」放大成 5 分钟内可被同一 owner 反复兑换。
const QR_REPLAY_WINDOW_SECONDS = 10
const QR_OWNER_COOKIE = 'vh_qr_owner'
const QR_CACHE_MAX_ENTRIES = 500
const QR_STORE_TIMEOUT_MS = 300

type QrLoginRecord = { cookie: string; at: number }

const qrLoginMemory = new Map<string, QrLoginRecord>()
const qrLoginCacheKey = (owner: string, unikey: string) => `${owner}:${unikey}`
const qrLoginRedisKey = (cacheKey: string) => buildRedisKey('netease-qr-login', cacheKey)

/** 共享存储只做加速：不可用或过慢时按进程内缓存处理，不阻塞登录链路 */
const getQrRedis = () =>
  withDeadline(getRedisClient(), QR_STORE_TIMEOUT_MS, 'qr-login-store').catch(() => null)

const readRequestCookie = (event: any, name: string): string => {
  const raw = event?.node?.req?.headers?.cookie
  if (typeof raw !== 'string') return ''
  for (const part of raw.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return ''
}

const rememberQrLogin = async (owner: string, unikey: string, cookie: string) => {
  const cacheKey = qrLoginCacheKey(owner, unikey)
  // 过期条目交给分钟级定时任务处理。到上限时按插入顺序淘汰最旧的一条，
  // 不能整体 clear，否则会误删其他访客仍在有效期内的 803 结果。
  if (qrLoginMemory.size >= QR_CACHE_MAX_ENTRIES) {
    const oldest = qrLoginMemory.keys().next()
    if (!oldest.done) qrLoginMemory.delete(oldest.value)
  }
  qrLoginMemory.set(cacheKey, { cookie, at: getServerTimestamp() })

  // 多实例部署（Vercel / Netlify）下首次 803 与前端重试可能落在不同实例，
  // 进程内缓存命中不了，配置 Redis 时写一份共享副本。写失败只影响补发，不影响登录。
  const redis = await getQrRedis()
  if (!redis) return
  await withDeadline(
    redis.set(qrLoginRedisKey(cacheKey), cookie, { EX: QR_LOGIN_TTL_SECONDS }),
    QR_STORE_TIMEOUT_MS,
    'qr-login-store'
  ).catch((error: unknown) => {
    console.warn(
      `[Netease] 扫码结果写入共享存储失败: ${error instanceof Error ? error.message : String(error)}`
    )
  })
}

const replayQrLogin = async (owner: string, unikey: string): Promise<string | undefined> => {
  const cacheKey = qrLoginCacheKey(owner, unikey)
  const hit = qrLoginMemory.get(cacheKey)
  if (hit) {
    const age = getServerTimestamp() - hit.at
    if (age <= QR_REPLAY_WINDOW_SECONDS * 1000) return hit.cookie
    // 超出补发窗口后即使缓存没过期也不再回放；命中时仍不删除，
    // 避免与并发轮询互相覆盖，统一交给 TTL 清理
    if (age > QR_LOGIN_TTL_SECONDS * 1000) qrLoginMemory.delete(cacheKey)
    return undefined
  }

  const redis = await getQrRedis()
  if (!redis) return undefined
  // 不在命中时删除：前端重试与轮询可能并发，先到的 803 删掉缓存后，
  // 后到的 800 会把成功状态覆盖成「已过期」。缓存由 TTL 统一回收。
  const sharedKey = qrLoginRedisKey(cacheKey)
  const shared = await withDeadline(
    redis.get(sharedKey),
    QR_STORE_TIMEOUT_MS,
    'qr-login-store'
  ).catch(() => null)
  if (!shared) return undefined
  // 共享副本只存了 cookie，用剩余 TTL 反推写入时间；拿不到 TTL 时保守不回放
  const remainingMs = await withDeadline(
    redis.pTTL(sharedKey),
    QR_STORE_TIMEOUT_MS,
    'qr-login-store'
  ).catch(() => -1)
  if (typeof remainingMs !== 'number' || remainingMs < 0) return undefined
  const age = QR_LOGIN_TTL_SECONDS * 1000 - remainingMs
  return age <= QR_REPLAY_WINDOW_SECONDS * 1000 ? shared : undefined
}

// 低流量下条目上限兜不住过期数据，按分钟兜底清理；unref 避免阻止进程退出
setInterval(() => {
  const cutoff = getServerTimestamp() - QR_LOGIN_TTL_SECONDS * 1000
  for (const [k, v] of qrLoginMemory) {
    if (v.at < cutoff) qrLoginMemory.delete(k)
  }
}, 60 * 1000).unref()

let ncmConfigReady = false
let ncmConfigPromise: Promise<void> | null = null

const ensureNcmConfig = (): Promise<void> => {
  if (ncmConfigReady) return Promise.resolve()
  if (!ncmConfigPromise) {
    ncmConfigPromise = import('@neteasecloudmusicapienhanced/api/generateConfig.js')
      .then((mod) => (mod.default || mod)())
      .then(() => {
        if (existsSync(xeapiPublicKeyPath)) {
          ncmConfigReady = true
          console.log('[Netease] xeapi 公钥初始化完成')
        } else {
          console.error('[Netease] xeapi 公钥生成失败，下次请求将重试')
        }
      })
      .catch((error: unknown) => {
        console.error('[Netease] xeapi 配置初始化失败:', error)
      })
      .finally(() => {
        ncmConfigPromise = null
      })
  }
  return ncmConfigPromise
}

// 预热配置，不阻塞启动
ensureNcmConfig()

const normalizeParams = (input: Record<string, any>) => {
  const output: Record<string, any> = {}
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    output[key] = Array.isArray(value) ? value[value.length - 1] : value
  }
  return output
}

export default defineEventHandler(async (event) => {
  const rawPath = getRouterParam(event, 'path')
  const endpointPath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath
  const method = getMethod(event)

  if (!endpointPath) {
    throw createError({
      statusCode: 400,
      message: '缺少网易云接口路径'
    })
  }

  if (!/^[a-z0-9/-]+$/i.test(endpointPath)) {
    throw createError({
      statusCode: 400,
      message: '网易云接口路径不合法'
    })
  }

  const allowedMethods = allowedEndpoints.get(endpointPath)
  if (!allowedMethods || !allowedMethods.has(method)) {
    console.warn(`[Netease] 拦截未放行的接口: ${method} ${endpointPath}`)
    throw createError({
      statusCode: 403,
      message: `禁止访问接口: ${endpointPath}`
    })
  }

  const action = endpointPath.replace(/\//g, '_').replace(/-/g, '_')
  const api = await neteaseEnhancedApiPromise
  const handler = api[action]

  if (typeof handler !== 'function') {
    throw createError({
      statusCode: 404,
      message: `未找到接口: ${endpointPath}`
    })
  }

  const rawQuery = getQuery(event)
  const queryParams = normalizeParams(rawQuery)
  let bodyParams: Record<string, any> = {}

  if (method !== 'GET') {
    const body = await readBody(event).catch(() => ({}))
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      bodyParams = normalizeParams(body as Record<string, any>)
    }
  }

  const params = { ...queryParams, ...bodyParams }
  // 出口 IP 只透传访客真实地址：网易云按请求来源判定地区，用访客地址才能让
  // 登录地点、账号校验与用户实际所处位置一致。客户端自带的 realIP 直接丢弃，
  // 避免该代理变成任意 IP 的伪造入口；拿不到访客地址时不注入，绝不回退伪造。
  delete params.realIP
  if (isNeteaseRealIpEnabled()) {
    const outboundIp = resolveNeteaseOutboundIp(getClientIP(event))
    if (outboundIp) {
      params.realIP = outboundIp
      if (process.env.NETEASE_REAL_IP_DEBUG === 'true') {
        console.log(`[Netease] ${endpointPath} 出口 IP: ${outboundIp}`)
      }
    } else if (process.env.NETEASE_REAL_IP_DEBUG === 'true') {
      // 拿不到访客公网 IP：不注入 realIP，由上游按服务器真实出口请求
      console.log(`[Netease] ${endpointPath} 未取到访客公网 IP，使用服务器出口`)
    }
  }

  // 等待 xeapi 公钥等配置就绪：超时或失败都继续，让上游错误以有界的失败返回，而不是无限等待
  await withDeadline(ensureNcmConfig(), NETEASE_CONFIG_TIMEOUT_MS, 'generateConfig').catch((error: unknown) => {
    console.warn(`[Netease] xeapi 配置初始化超时: ${error instanceof Error ? error.message : String(error)}`)
  })
  try {
    const result = await withDeadline(handler(params), NETEASE_CALL_TIMEOUT_MS, endpointPath)
    if (Array.isArray(result?.cookie) && result.cookie.length > 0) {
      setHeader(event, 'set-cookie', result.cookie)
    }
    if (typeof result?.status === 'number') {
      setResponseStatus(event, result.status)
    }
    const body = result?.body ?? result
    // 扫码结果补发：803 只在网易云侧出现一次，前端那次响应若被网关打断（502/504），
    // cookie 就永久丢失，用户看到的是「手机确认成功却没登上」。按 unikey 暂存后回放。
    // 复用的 owner 让同一浏览器重开二维码时仍能回放到自己那次的 803。
    if (endpointPath === 'login/qr/key' && !readRequestCookie(event, QR_OWNER_COOKIE)) {
      appendHeader(
        event,
        'set-cookie',
        `${QR_OWNER_COOKIE}=${randomBytes(16).toString('hex')}; Path=/api/api-enhanced/netease` +
          `; Max-Age=${QR_LOGIN_TTL_SECONDS}; HttpOnly; SameSite=Lax`
      )
    }
    if (endpointPath === 'login/qr/check') {
      const qrKey = typeof params.key === 'string' ? params.key : ''
      const owner = readRequestCookie(event, QR_OWNER_COOKIE)
      const code = Number(body?.code)
      const loginCookie = typeof body?.cookie === 'string' ? body.cookie : ''
      // owner 缺失（客户端禁用 Cookie）时不缓存也不回放，退回改造前的行为
      if (qrKey && owner && code === 803 && loginCookie) {
        await rememberQrLogin(owner, qrKey, loginCookie)
      } else if (qrKey && owner && code !== 803) {
        const replayed = await replayQrLogin(owner, qrKey)
        if (replayed) {
          // 只回干净结构，避免把上游的「二维码已过期」等文案一起带给前端
          return { code: 803, message: '登录成功', cookie: replayed }
        }
      }
    }
    return body
  } catch (error: any) {
    // 上游模块以 { status, body: { code, msg } } 形态抛出失败，真实原因在 body.msg
    const upstream = error?.body ?? null
    const upstreamMessage = upstream?.msg || upstream?.message || error?.message
    console.warn(`[Netease] ${endpointPath} 调用失败: ${error?.status || 500} ${upstreamMessage}`)
    throw createError({
      statusCode: error?.statusCode || error?.status || 500,
      message: upstreamMessage || '网易云接口调用失败',
      data: { endpoint: endpointPath, upstream }
    })
  }
})

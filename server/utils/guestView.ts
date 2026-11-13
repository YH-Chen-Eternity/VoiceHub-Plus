import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie, type H3Event } from 'h3'
import { lt } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityGuestViews } from '~/drizzle/schema'

/**
 * 游客（未登录）浏览量去重。
 *
 * 用一个 HttpOnly 签名 cookie 保存匿名 id：值为 `id.sig`，sig = HMAC(secret, id)，
 * 服务端校验签名后才信任，避免客户端伪造/刷量。入库只保存 id 的二次哈希，不留可用身份。
 * 计数以「同一游客 · 同一帖子 · 同一小时桶」为唯一键，配合 onConflictDoNothing 原子去重，
 * 与登录用户 communityPostViews 的 (postId,userId) 口径一致。
 */

const COOKIE_NAME = 'vh_cid'
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60
const HOUR_MS = 60 * 60 * 1000

// 进程级兜底密钥：生产应配置 JWT_SECRET / MEDIA_TOKEN_SECRET；两者都没有时用随机值，
// 效果是进程重启后旧 cookie 失效并自动换发新 cookie，不影响功能与安全。
const fallbackSecret = randomBytes(32).toString('hex')

function getSecret(): string {
  return String(process.env.MEDIA_TOKEN_SECRET || process.env.JWT_SECRET || fallbackSecret)
}

function sign(id: string): string {
  return createHmac('sha256', getSecret()).update(id).digest('base64url').slice(0, 22)
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** 从签名 cookie 读取匿名 id；无效则换发新 id。返回匿名 id（不落库明文） */
function getOrCreateGuestId(event: H3Event): string {
  const raw = getCookie(event, COOKIE_NAME)
  if (raw) {
    const dot = raw.lastIndexOf('.')
    if (dot > 0) {
      const id = raw.slice(0, dot)
      const sig = raw.slice(dot + 1)
      if (/^[0-9a-f]{32}$/.test(id) && sig && safeEqual(sig, sign(id))) {
        return id
      }
    }
  }
  const id = randomBytes(16).toString('hex')
  setCookie(event, COOKIE_NAME, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE
  })
  return id
}

/** 匿名 id → 入库哈希（不可逆，且绑定服务端密钥） */
function hashGuestId(id: string): string {
  return createHash('sha256').update(`${id}.${getSecret()}`).digest('hex').slice(0, 40)
}

/**
 * 记录一次游客浏览。返回本次是否计数（true 表示 viewCount 应 +1）。
 * 只在帖子已 APPROVED 时由调用方触发；任何异常都吞掉并按「不计数」处理，绝不影响详情读取。
 */
export async function recordGuestView(event: H3Event, postId: number): Promise<boolean> {
  const counted = await recordGuestViews(event, [postId])
  return counted.length > 0
}

/**
 * 批量记录游客浏览（列表曝光用）。返回本次真正计数成功的帖子 id。
 * 与单条记录共用同一 cookie / 小时桶去重口径，批量插入一次完成，避免 N 次往返。
 */
export async function recordGuestViews(event: H3Event, postIds: number[]): Promise<number[]> {
  const ids = [...new Set(postIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return []
  try {
    const guestHash = hashGuestId(getOrCreateGuestId(event))
    const hourBucket = Math.floor(Date.now() / HOUR_MS)
    const inserted = await db
      .insert(communityGuestViews)
      .values(ids.map((postId) => ({ postId, guestHash, hourBucket })))
      .onConflictDoNothing()
      .returning({ postId: communityGuestViews.postId })
    return inserted.map((row) => Number(row.postId))
  } catch {
    return []
  }
}

/** 清理过期的游客浏览桶（保留最近 2 小时），供归档清理任务低调用 */
export async function purgeExpiredGuestViews(): Promise<number> {
  try {
    const cutoff = Math.floor((Date.now() - 2 * HOUR_MS) / HOUR_MS)
    const removed = await db
      .delete(communityGuestViews)
      .where(lt(communityGuestViews.hourBucket, cutoff))
      .returning({ postId: communityGuestViews.postId })
    return removed.length
  } catch {
    return 0
  }
}

/** 供测试与其它模块复用的常量 */
export const GUEST_VIEW_COOKIE = COOKIE_NAME

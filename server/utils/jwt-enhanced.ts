/* Modified by YH-Chen-Eternity on 2026-10-23 */

import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'

// 简化的JWT载荷接口
export interface JWTPayload {
  userId: number
  role: string
  jti: string // JWT ID，用于唯一标识token
  tokenVersion?: number
  iat?: number
  exp?: number
}

/**
 * HS256 的唯一信任根就是这把密钥：长度不足或照抄示例值的密钥可被离线爆破，
 * 爆破后即可伪造任意 userId/role 的令牌。因此在启动期（首次加载本模块）直接
 * 拒绝弱密钥，宁可起不来，也不带着可伪造的认证根对外服务。
 */
const JWT_SECRET_MIN_LENGTH = 32
const WEAK_JWT_SECRETS = new Set(['secret', 'changeme', 'jwt', 'password', 'test', 'dev'])
const WEAK_JWT_SECRET_FRAGMENTS = [
  'your-jwt-secret-here',
  'your-very-secure-jwt-secret-key',
  'change-me',
  'replace-me',
  'example-secret'
]
/** 去重后的字符种类下限：32 个相同字符长度达标但没有任何熵 */
const JWT_SECRET_MIN_CHAR_KINDS = 12

export function loadJwtSecret(): string {
  const raw = process.env.JWT_SECRET
  if (!raw) {
    throw new Error('JWT_SECRET environment variable is not set')
  }

  const secret = raw.trim()
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }

  // 先识别弱样本再判长度：示例值往往本身就短，报「用了示例口令」比报长度更有指导性
  const lowered = secret.toLowerCase()
  if (
    WEAK_JWT_SECRETS.has(lowered) ||
    WEAK_JWT_SECRET_FRAGMENTS.some((fragment) => lowered.includes(fragment))
  ) {
    throw new Error('JWT_SECRET 使用了已知的示例/弱口令，请重新生成随机密钥')
  }

  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(`JWT_SECRET 长度必须 >= ${JWT_SECRET_MIN_LENGTH}，请使用高熵随机字符串`)
  }

  if (new Set(secret).size < JWT_SECRET_MIN_CHAR_KINDS) {
    throw new Error('JWT_SECRET 熵过低（字符种类不足），请使用高熵随机字符串')
  }

  return secret
}

/**
 * 启动期校验入口：失败时先打一行可直接检索的摘要，再把原错误抛出去让进程退出。
 * 静态字段与 Nitro 插件都走这里——模块加载即校验，早于路由 chunk 与端口监听。
 */
export function loadJwtSecretOrFail(): string {
  try {
    return loadJwtSecret()
  } catch (error) {
    console.error(
      '[security] JWT_SECRET 校验未通过，拒绝启动：' +
        (error instanceof Error ? error.message : String(error))
    )
    throw error
  }
}

/**
 * 简化的JWT工具类 - 仅支持单一JWT token验证
 */
export class JWTEnhanced {
  private static readonly JWT_SECRET = loadJwtSecretOrFail()
  private static readonly TOKEN_EXPIRES = '6h'
  private static readonly REFRESH_THRESHOLD = 0

  static hasCurrentTokenVersion(
    payload: { tokenVersion?: unknown } | null | undefined,
    currentTokenVersion: number
  ): boolean {
    return (
      typeof payload?.tokenVersion === 'number' &&
      Number.isInteger(payload.tokenVersion) &&
      payload.tokenVersion === currentTokenVersion
    )
  }

  /**
   * 通用签名方法
   */
  static sign(payload: object, options?: jwt.SignOptions): string {
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is not set')
    }
    return jwt.sign(payload, this.JWT_SECRET, options)
  }

  /**
   * 通用验证方法
   */
  static verify(token: string): any {
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is not set')
    }
    return jwt.verify(token, this.JWT_SECRET)
  }

  /**
   * 生成JWT token
   */
  static generateToken(userId: number, role: string, tokenVersion = 0, sessionId?: string): string {
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is not set')
    }

    // 生成唯一的JWT ID
    const jti = sessionId || randomUUID()

    // JWT载荷
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId,
      role,
      jti,
      tokenVersion
    }

    // 生成token
    const token = jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: this.TOKEN_EXPIRES
    })

    console.log(`Generated JWT token for user ${userId}`)
    return token
  }

  /**
   * 验证并解码token
   */
  static verifyToken(token: string): JWTPayload {
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is not set')
    }

    try {
      // 验证并解码token
      const decoded = jwt.verify(token, this.JWT_SECRET) as JWTPayload

      // 验证必要字段
      if (!decoded.userId || !decoded.role || !decoded.jti) {
        throw new Error('Invalid token payload: missing required fields')
      }

      return decoded
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token has expired', { cause: error })
      }
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token signature', { cause: error })
      }
      if (error.name === 'NotBeforeError') {
        throw new Error('Token not active yet', { cause: error })
      }
      throw new Error(`Token verification failed: ${error.message}`, { cause: error })
    }
  }

  /**
   * 获取token信息（不验证签名）
   */
  static getTokenInfo(token: string): JWTPayload | null {
    try {
      const decoded = jwt.decode(token) as JWTPayload
      return decoded && decoded.userId ? decoded : null
    } catch (error: any) {
      return null
    }
  }

  /**
   * 检查token是否已过期
   */
  static isTokenExpired(token: string): boolean {
    const decoded = this.getTokenInfo(token)
    if (!decoded || !decoded.exp) return true

    const now = Math.floor(Date.now() / 1000)
    return decoded.exp <= now
  }

  /**
   * 获取token剩余有效时间（秒）
   */
  static getTokenRemainingTime(token: string): number {
    const decoded = this.getTokenInfo(token)
    if (!decoded || !decoded.exp) return 0

    const now = Math.floor(Date.now() / 1000)
    return Math.max(0, decoded.exp - now)
  }

  /**
   * 检查token是否需要续期
   * @param token JWT token
   * @param thresholdSeconds 续期阈值（秒），默认24小时
   * @returns 是否需要续期
   */
  static shouldRefreshToken(
    token: string,
    thresholdSeconds: number = this.REFRESH_THRESHOLD
  ): boolean {
    const remainingTime = this.getTokenRemainingTime(token)
    return remainingTime > 0 && remainingTime <= thresholdSeconds
  }

  /**
   * 刷新token（生成新的token）
   * @param oldToken 旧的token
   * @returns 新的token
   */
  static refreshToken(oldToken: string): string {
    const decoded = this.verifyToken(oldToken)

    // 使用原有的用户信息生成新token
    return this.generateToken(decoded.userId, decoded.role, decoded.tokenVersion ?? 0, decoded.jti)
  }

  /**
   * 验证token并自动续期（如果需要）
   * @param token JWT token
   * @returns { valid: boolean, payload?: JWTPayload, newToken?: string }
   */
  static verifyAndRefresh(token: string): {
    valid: boolean
    payload?: JWTPayload
    newToken?: string
  } {
    try {
      const payload = this.verifyToken(token)

      // 检查是否需要续期
      if (this.shouldRefreshToken(token)) {
        const newToken = this.refreshToken(token)
        console.log(`Token auto-refreshed for user ${payload.userId}`)
        return {
          valid: true,
          payload,
          newToken
        }
      }

      return {
        valid: true,
        payload
      }
    } catch (error: any) {
      return {
        valid: false
      }
    }
  }
}

// 导出默认实例
export default JWTEnhanced

/**
 * HTTP 方法策略：按路径语义收敛允许的方法。
 *
 * 页面与静态资源只接受渲染所需的安全方法，接口按业务实际使用的方法放行，
 * 未声明的方法统一返回 405，避免非预期方法进入渲染或处理流程。
 * - 页面（含静态资源）：GET / HEAD / OPTIONS
 * - API：GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS
 */

export const PAGE_ALLOWED_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const
export const API_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export type MethodCheckResult = {
  allowed: boolean
  allow: readonly string[]
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

export function checkRequestMethod(pathname: string, method: string): MethodCheckResult {
  const allow: readonly string[] = isApiPath(pathname) ? API_ALLOWED_METHODS : PAGE_ALLOWED_METHODS
  const normalized = String(method || '').trim().toUpperCase()
  return {
    allowed: normalized.length > 0 && allow.includes(normalized),
    allow
  }
}

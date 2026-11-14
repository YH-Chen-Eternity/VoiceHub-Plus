import { checkRequestMethod } from '~~/server/utils/httpMethodPolicy'

/**
 * 方法守卫：在进入路由前拒绝该路径不支持的方法，并返回 Allow 头。
 * 需排在鉴权与业务中间件之前（文件名 05. 保证在 00.request-id 之后、api-auth 之前）。
 */
export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  const { allowed, allow } = checkRequestMethod(pathname, getMethod(event))
  if (allowed) return

  setHeader(event, 'Allow', allow.join(', '))
  throw createError({ statusCode: 405, message: '方法不被允许' })
})

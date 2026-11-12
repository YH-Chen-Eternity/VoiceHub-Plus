/**
 * 存活探针的 HEAD 变体：部分负载均衡 / 容器探针只用 HEAD，GET 路由不匹配 HEAD 会 404。
 * 与 GET 保持同一组响应头，空响应体。
 */
export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 200)
  return ''
})

/**
 * 测试用的 h3 最小替身。
 *
 * 这些测试用 esbuild 把服务端模块打成 data: URL 再加载，裸模块名无法在
 * data: URL 里解析，所以把用到的 h3 能力映射到这里。
 */
export function getHeaders(event: any): Record<string, string> {
  return event?.node?.req?.headers || event?.headers || {}
}

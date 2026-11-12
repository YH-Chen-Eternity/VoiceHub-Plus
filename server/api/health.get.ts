/**
 * 存活探针：供容器 healthcheck 与宿主机看门狗判断进程能否正常响应。
 * 只反映进程自身存活，不查数据库 / Redis——依赖故障时重启应用无效，由看门狗单独处理依赖容器。
 * 公开无鉴权，响应不含版本、提交、主机名等任何环境信息。
 */
export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  return { status: 'ok' }
})

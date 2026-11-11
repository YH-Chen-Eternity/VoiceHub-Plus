/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { createError, defineEventHandler } from 'h3'
import { databaseManager } from '~~/server/utils/database-manager'
import { getInstanceId } from '~~/server/utils/instance-id'
import { isTelemetryEnabled } from '~~/server/utils/telemetry'

const FULL_ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']
// 放歌员 / 歌曲管理员：管理后台数据概览也会读取系统状态（2026-10-23 收紧到仅管理员后，
// 他们的概览页数据库/API 全部显示「异常」，构成回归）。允许他们拿到「服务是否正常」的
// 最小结论，但不返回连接池、实例 ID、进程内存等内部细节。
const OVERVIEW_ROLES = ['SONG_ADMIN', 'BROADCASTER']

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || (!FULL_ADMIN_ROLES.includes(user.role) && !OVERVIEW_ROLES.includes(user.role))) {
    throw createError({ statusCode: 403, message: '只有管理员可以查看系统状态' })
  }

  // 数据库连通性探测：对所有允许的角色都执行（这是概览页唯一需要的真实信号）。
  // 探测异常按「数据库不可达」处理，绝不让该接口 500——概览页靠它区分「服务挂了」和「无权查看」。
  let dbStatus: { connected: boolean; error?: string | null } = { connected: false, error: null }
  try {
    dbStatus = await databaseManager.getConnectionStatus()
  } catch (dbError: any) {
    console.error('[System Status] 数据库连通性探测失败:', dbError)
  }

  if (!FULL_ADMIN_ROLES.includes(user.role)) {
    return {
      status: 'ok',
      database: {
        connected: dbStatus.connected
      }
    }
  }

  try {
    const instanceId = await getInstanceId()
    const telemetryEnabled = await isTelemetryEnabled()

    let poolStatus = null
    try {
      poolStatus = await databaseManager.getConnectionPoolStatus()
    } catch (poolError: any) {
      console.warn('[System Status] Failed to get database pool status:', poolError)
    }

    const dbTestResult = dbStatus.connected
    const dbError = dbStatus.connected ? null : dbStatus.error

    // 获取系统信息
    const systemInfo = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      }
    }

    // 返回完整的系统状态
    return {
      status: 'ok',
      instance: {
        instanceId,
        telemetryEnabled
      },
      database: {
        connected: dbTestResult,
        poolStatus: poolStatus,
        connectionInfo: dbStatus,
        error: dbError
      },
      system: systemInfo
    }
  } catch (error: any) {
    // 细节只进服务端日志，响应不暴露内部错误（2026-10-23 安全加固）
    console.error('[System Status] 获取系统状态失败:', error)

    return {
      status: 'error',
      error: '获取系统状态失败',
      database: {
        connected: false,
        poolStatus: null,
        error: '获取数据库状态失败'
      }
    }
  }
})

import { ApiLogService } from '~~/server/services/apiLogService'
import { resolvePagination } from '~~/server/utils/pagination'

/**
 * 获取API访问日志
 * GET /api/admin/api-keys/logs
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { page, limit } = resolvePagination(query.page, query.limit, 50, 500)
  const apiKeyId = query.apiKeyId as string
  const endpoint = query.endpoint as string
  const method = query.method as string
  const statusCode = query.statusCode ? parseInt(query.statusCode as string) : undefined
  const startDate = query.startDate as string
  const endDate = query.endDate as string
  const ipAddress = query.ipAddress as string

  try {
    // 使用ApiLogService获取日志
    const result = await ApiLogService.getLogs({
      apiKeyId,
      endpoint,
      method: method?.toUpperCase(),
      statusCode,
      ipAddress,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page,
      limit
    })

    // 获取统计信息
    const stats = await ApiLogService.getStats({
      apiKeyId,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    })

    return {
      logs: result.logs,
      pagination: result.pagination,
      stats: stats.basic
    }
  } catch (error: any) {
    console.error('获取 API 访问日志失败:', error)
    throw createError({
      statusCode: 500,
      message: '获取 API 访问日志失败'
    })
  }
})

import { createHash } from 'node:crypto'

/**
 * 社区发帖的批量拆分与去重策略。
 * 纯函数集中在此，便于单元测试覆盖分组边界、纯图帖去重与并发上限。
 */

/** 单帖图片数硬上限：与审核链路单次可处理的图片数、后台配置项取值域保持一致 */
export const MAX_IMAGES_PER_POST = 9

/** 批量审核并发上限：避免串行过慢，也不让一次发帖把审核通道打满 */
export const MODERATION_CONCURRENCY = 3

/** 单帖内图片审核并发上限 */
export const IMAGE_MODERATION_CONCURRENCY = 4

/** 把后台配置的「每帖图片数」收敛到 [1, 9]；非法值回落到 9 */
export function resolveImagesPerPost(configured: unknown): number {
  const parsed = Number(configured)
  if (!Number.isFinite(parsed) || parsed < 1) return MAX_IMAGES_PER_POST
  return Math.min(Math.trunc(parsed), MAX_IMAGES_PER_POST)
}

/**
 * 按每帖图片数把图片切分为若干组。
 * - 无图片（纯文字帖）返回单组空数组，保证至少产生一个帖子；
 * - 余数不足一组时单独成帖。
 */
export function splitImageGroups(imageIds: number[], perPost: number): number[][] {
  const size = resolveImagesPerPost(perPost)
  if (imageIds.length === 0) return [[]]
  const groups: number[][] = []
  for (let i = 0; i < imageIds.length; i += size) {
    groups.push(imageIds.slice(i, i + size))
  }
  return groups
}

/** 正文规范化 hash：忽略大小写、空白与标点，用于重复发帖检测 */
export function hashCommunityContent(content: string): string {
  const normalized = String(content ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * 生成帖子的去重指纹：
 * - 有正文时沿用正文 hash，与历史去重口径保持一致；
 * - 纯图帖没有正文，改用该帖图片集合生成，避免所有纯图帖被判为同一内容。
 */
export function computePostHash(content: string, imageIds: number[]): string {
  if (String(content ?? '').trim()) return hashCommunityContent(content)
  const key = Array.from(new Set(imageIds)).sort((a, b) => a - b).join(',')
  return createHash('sha256').update(`community-images:${key}`).digest('hex')
}

/** 发帖内容校验：正文与图片至少其一；返回错误码或 null */
export function validatePostInput(
  content: string,
  imageCount: number,
  maxContentLength: number
): string | null {
  if (!content && imageCount === 0) return 'COMMUNITY_CONTENT_REQUIRED'
  if (content.length > maxContentLength) return 'COMMUNITY_CONTENT_TOO_LONG'
  return null
}

/** 受控并发执行，结果顺序与输入一致；任一任务失败则整体抛出 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) return results
  const size = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length))
  let cursor = 0
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(runners)
  return results
}

/** 汇总整批帖子的最终状态：有拦截则拦截，有待审则待审，其余为通过 */
export function summarizeBatchStatus(statuses: string[]): string {
  if (statuses.includes('BLOCKED')) return 'BLOCKED'
  if (statuses.includes('PENDING')) return 'PENDING'
  return 'APPROVED'
}

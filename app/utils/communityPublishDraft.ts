/**
 * 社区发帖草稿 / 图片级断点续传的纯逻辑（无浏览器依赖，便于单测）。
 *
 * 设计口径：
 * - 每张待发图片用「文件名 + 大小 + 修改时间 + 类型」生成稳定指纹 key；
 * - 上传成功的图片记录 mediaId / url，刷新后按 key 直接跳过，不再重传；
 * - 未完成的图片保留原始 Blob（由 communityDraftStore 落在 IndexedDB），刷新后继续；
 * - 草稿只保留一份，放弃时清理，不改动已发布帖子与图片存储链路。
 */

export const COMMUNITY_DRAFT_VERSION = 1
export const COMMUNITY_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/**
 * 单份草稿最多保存的图片数（持久化与放弃清理的保护上限，不是发帖数量限制）。
 * 单次选图不设数量上限，超出此值的部分在并入草稿时截断；服务端放弃清理同额度对齐。
 */
export const COMMUNITY_DRAFT_MAX_IMAGES = 500

export type DraftImage = {
  key: string
  name: string
  size: number
  type: string
  /** 已上传成功的媒体 id；为空表示仍需上传 */
  id?: number
  url?: string
  /** 仅内存：本地 blob 预览 URL 或缩略图 URL，不持久化（objectURL 刷新后失效） */
  previewUrl?: string
  /** 仅内存 / IndexedDB 中保存，不进 JSON 草稿 */
  blob?: Blob
}

export type PublishDraft = {
  version: number
  boardId: number
  content: string
  nameMode: string
  song: { id: number; title: string; artist: string; cover: string } | null
  images: DraftImage[]
  updatedAt: number
}

/** 稳定指纹：不读取文件内容，避免大图 hash 拖慢选图交互 */
export function makeDraftImageKey(file: {
  name?: string
  size?: number
  lastModified?: number
  type?: string
}): string {
  return [file.name || '', file.size || 0, file.lastModified || 0, file.type || ''].join('|')
}

/** 把新选文件并入草稿：按 key 去重，已上传成功的 id 不丢失 */
export function mergeDraftImages(
  existing: DraftImage[],
  added: DraftImage[],
  maxImages: number = COMMUNITY_DRAFT_MAX_IMAGES
): DraftImage[] {
  const byKey = new Map<string, DraftImage>()
  for (const image of existing) {
    if (image?.key) byKey.set(image.key, image)
  }
  for (const image of added) {
    if (!image?.key || byKey.has(image.key)) continue
    byKey.set(image.key, image)
  }
  return Array.from(byKey.values()).slice(0, Math.max(0, maxImages))
}

/** 移除某张图（放弃单张时调用） */
export function removeDraftImage(images: DraftImage[], key: string): DraftImage[] {
  return images.filter((image) => image.key !== key)
}

/** 标记某张图已上传成功 */
export function markDraftUploaded(
  images: DraftImage[],
  key: string,
  id: number,
  url: string
): DraftImage[] {
  return images.map((image) =>
    image.key === key ? { ...image, id, url, blob: undefined } : image
  )
}

/** 草稿有效性：版本、时限、结构都要合法，避免旧格式或脏数据导致恢复异常 */
export function isDraftUsable(draft: unknown, now = Date.now()): draft is PublishDraft {
  if (!draft || typeof draft !== 'object') return false
  const value = draft as Partial<PublishDraft>
  if (value.version !== COMMUNITY_DRAFT_VERSION) return false
  if (!Number.isFinite(value.updatedAt)) return false
  if (now - Number(value.updatedAt) > COMMUNITY_DRAFT_TTL_MS) return false
  if (!Array.isArray(value.images)) return false
  if (value.images.length > COMMUNITY_DRAFT_MAX_IMAGES) return false
  if (typeof value.content !== 'string') return false
  return true
}

export function countPendingImages(images: DraftImage[]): number {
  return images.filter((image) => !image.id && image.blob).length
}

export function countUploadedImages(images: DraftImage[]): number {
  return images.filter((image) => !!image.id).length
}

/** 提交时只取已成功上传的 id，防止把未完成项带进发帖请求 */
export function collectUploadedImageIds(images: DraftImage[]): number[] {
  return Array.from(
    new Set(images.filter((image) => Number.isInteger(image.id) && Number(image.id) > 0).map((image) => Number(image.id)))
  )
}

/** 结构化克隆到可 JSON 持久化形态（丢弃 Blob 与临时预览 URL，Blob 由 IndexedDB 单独存） */
export function toStorableDraft(draft: PublishDraft): PublishDraft {
  return {
    ...draft,
    images: draft.images.map(({ blob: _blob, previewUrl: _previewUrl, ...rest }) => rest)
  }
}

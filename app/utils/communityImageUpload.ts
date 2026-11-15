/**
 * 社区发帖图片上传编排：文件头校验 → Worker 并行压缩 → 并行上传 → 断点续传。
 *
 * 这些是社区发帖的通用能力，与「多图批量拆帖」开关无关，始终启用。
 * 服务端仍独立做魔数校验 / 完整解码 / 重编码 / sha256 复用，不信任前端结论。
 */
import {
  COMMUNITY_IMAGE_MAX_BYTES,
  COMMUNITY_IMAGE_MAX_UPLOAD_BYTES,
  FULL_SIZE_QUALITIES,
  DOWNSCALE_STEPS,
  MAX_PIXELS,
  compressCommunityImageFile,
  isCommunityImageType
} from '~/utils/communityImage'
import {
  validateImageHeader,
  MAGIC_HEADER_BYTES
} from '~/utils/communityImageMagic.js'
import type { DraftImage } from '~/utils/communityPublishDraft'

export const UPLOAD_CONCURRENCY = 3
export const COMPRESS_CONCURRENCY = 2

/** 受控并发；结果按输入顺序返回，单项失败不影响其他项 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length)
  if (!items.length) return results
  const size = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length))
  let cursor = 0
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = { ok: true, value: await worker(items[index]!, index) }
      } catch (error) {
        results[index] = { ok: false, error }
      }
    }
  })
  await Promise.all(runners)
  return results
}

export type PreparedImage = {
  key: string
  file: File
  /** 已通过文件头校验，且大小在上限内 */
  valid: boolean
  reason?: 'type' | 'header' | 'too-large'
}

/** 选图阶段的前置校验：MIME 白名单 + 文件头魔数 + 原始大小上限 */
export async function prepareImageFile(file: File, key: string): Promise<PreparedImage> {
  if (!isCommunityImageType(file.type)) return { key, file, valid: false, reason: 'type' }
  if (file.size > COMMUNITY_IMAGE_MAX_UPLOAD_BYTES) {
    return { key, file, valid: false, reason: 'too-large' }
  }
  try {
    const header = new Uint8Array(await file.slice(0, MAGIC_HEADER_BYTES).arrayBuffer())
    const check = validateImageHeader(header, file.type)
    if (!check.ok) return { key, file, valid: false, reason: 'header' }
  } catch {
    return { key, file, valid: false, reason: 'header' }
  }
  return { key, file, valid: true }
}

type WorkerReply = {
  id: number
  ok: boolean
  buffer?: ArrayBuffer
  mime?: string
  filename?: string
  compressed?: boolean
  reason?: string
}

/** 单个 Worker 实例 + 消息 id 关联，实现并行压缩；能力不足时整批回退主线程 */
class ImageWorkerPool {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, (reply: WorkerReply) => void>()
  private broken = false

  private ensure(): Worker | null {
    if (this.broken) return null
    if (this.worker) return this.worker
    if (typeof Worker === 'undefined') {
      this.broken = true
      return null
    }
    try {
      const worker = new Worker(
        new URL('../workers/communityImageWorker.js', import.meta.url),
        { type: 'module' }
      )
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const resolve = this.pending.get(event.data?.id)
        if (resolve) {
          this.pending.delete(event.data.id)
          resolve(event.data)
        }
      }
      worker.onerror = () => {
        this.broken = true
        for (const resolve of this.pending.values()) {
          resolve({ id: -1, ok: false, reason: 'worker-error' })
        }
        this.pending.clear()
        this.dispose()
      }
      this.worker = worker
      return worker
    } catch {
      this.broken = true
      return null
    }
  }

  async compress(file: File): Promise<{ file: File; compressed: boolean } | null> {
    const worker = this.ensure()
    if (!worker) return null
    const id = ++this.seq
    let buffer: ArrayBuffer
    try {
      buffer = await file.arrayBuffer()
    } catch {
      return null
    }
    const reply = await new Promise<WorkerReply>((resolve) => {
      this.pending.set(id, resolve)
      try {
        worker.postMessage(
          {
            id,
            buffer,
            mime: file.type,
            filename: file.name,
            maxBytes: COMMUNITY_IMAGE_MAX_BYTES,
            maxUploadBytes: COMMUNITY_IMAGE_MAX_UPLOAD_BYTES,
            maxPixels: MAX_PIXELS,
            qualities: FULL_SIZE_QUALITIES,
            downscaleSteps: DOWNSCALE_STEPS
          },
          [buffer]
        )
      } catch {
        this.pending.delete(id)
        resolve({ id, ok: false, reason: 'post-failed' })
      }
    })
    if (!reply.ok || !reply.buffer) return null
    return {
      file: new File([reply.buffer], reply.filename || file.name, {
        type: reply.mime || file.type
      }),
      compressed: !!reply.compressed
    }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }
}

let sharedPool: ImageWorkerPool | null = null
function getPool(): ImageWorkerPool {
  if (!sharedPool) sharedPool = new ImageWorkerPool()
  return sharedPool
}

/** 压缩单张图：优先 Worker，失败/不支持时回退主线程原有实现 */
export async function compressForUpload(
  file: File
): Promise<{ file: File; compressed: boolean }> {
  const fromWorker = await getPool().compress(file)
  if (fromWorker) return fromWorker
  try {
    return await compressCommunityImageFile(file)
  } catch {
    return { file, compressed: false }
  }
}

export type UploadProgress = {
  phase: 'compressing' | 'uploading'
  done: number
  total: number
  uploaded: number
  failed: number
}

export type UploadOrchestratorOptions = {
  images: DraftImage[]
  concurrency?: number
  compressConcurrency?: number
  onProgress?: (progress: UploadProgress) => void
  onUploaded?: (key: string, id: number, url: string, reused: boolean) => void
  shouldAbort?: () => boolean
}

export type UploadOutcome = {
  succeeded: number
  failed: number
  aborted: boolean
  failedKeys: string[]
}

/**
 * 并行压缩 + 并行上传。已带 id 的图片（草稿恢复 / 断点续传）直接跳过；
 * 每张图成功后立刻回调，调用方即时落草稿，刷新后即可跳过。
 */
export async function uploadDraftImages(options: UploadOrchestratorOptions): Promise<UploadOutcome> {
  const {
    images,
    concurrency = UPLOAD_CONCURRENCY,
    compressConcurrency = COMPRESS_CONCURRENCY,
    onProgress,
    onUploaded,
    shouldAbort
  } = options

  const pending = images.filter((image) => !image.id && image.blob)
  const total = pending.length
  let uploaded = 0
  let failed = 0
  let aborted = false
  const failedKeys: string[] = []

  // 压缩阶段：并行执行，逐张回调进度；失败项保留 key 供重试
  let compressedDone = 0
  const compressed = await runWithConcurrency(pending, compressConcurrency, async (image) => {
    const source = new File([image.blob!], image.name, { type: image.type })
    try {
      const result = await compressForUpload(source)
      return { image, file: result.file }
    } finally {
      compressedDone += 1
      onProgress?.({ phase: 'compressing', done: compressedDone, total, uploaded, failed })
    }
  })

  const ready: Array<{ image: DraftImage; file: File }> = []
  compressed.forEach((item, index) => {
    if (item.ok) {
      ready.push(item.value)
    } else {
      failed += 1
      failedKeys.push(pending[index]?.key || '')
    }
  })

  // 上传阶段：并发受限，每张成功即时回调，调用方立刻落草稿实现断点续传
  let uploadDone = failed
  const reportUpload = () =>
    onProgress?.({ phase: 'uploading', done: uploadDone, total, uploaded, failed })

  await runWithConcurrency(ready, concurrency, async ({ image, file }) => {
    if (aborted || shouldAbort?.()) {
      aborted = true
      return
    }
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await $fetch<{
        id: number
        url: string
        reused?: boolean
      }>('/api/community/media', { method: 'POST', body: form })
      uploaded += 1
      onUploaded?.(image.key, res.id, res.url, !!res.reused)
    } catch {
      failed += 1
      failedKeys.push(image.key)
    } finally {
      uploadDone += 1
      reportUpload()
    }
  })

  return {
    succeeded: uploaded,
    failed,
    aborted,
    failedKeys: Array.from(new Set(failedKeys.filter(Boolean)))
  }
}

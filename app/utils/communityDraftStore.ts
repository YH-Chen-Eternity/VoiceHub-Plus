/**
 * 社区发帖草稿持久化：页面刷新后恢复表单与未上传完成的图片。
 *
 * - 元数据（文案 / 板块 / 已上传成功的 mediaId）走 localStorage，同步读取、开销小；
 * - 未完成图片的原始 Blob 走 IndexedDB，容量足够且不污染 localStorage；
 * - 两者都不可用时静默降级为「仅当前会话内可发布」，绝不阻断发帖。
 */
import {
  COMMUNITY_DRAFT_VERSION,
  isDraftUsable,
  toStorableDraft,
  type DraftImage,
  type PublishDraft
} from '~/utils/communityPublishDraft'

const META_KEY = 'voicehub:community:publish-draft:v1'
const DB_NAME = 'voicehub-community'
const DB_VERSION = 1
const STORE = 'publish-draft-blobs'

export const emptyDraft = (): PublishDraft => ({
  version: COMMUNITY_DRAFT_VERSION,
  boardId: 0,
  content: '',
  nameMode: 'semi',
  song: null,
  images: [],
  updatedAt: Date.now()
})

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** 保存未完成图片的 Blob；失败静默降级 */
export async function saveDraftBlobs(images: DraftImage[]): Promise<void> {
  const blobs = images.filter((image) => !image.id && image.blob)
  if (!blobs.length) return
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const image of blobs) store.put(image.blob, image.key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } finally {
    db.close()
  }
}

/** 读取 Blob 并挂回草稿图片；缺失或失败时该项会被跳过上传 */
export async function loadDraftBlobs(draft: PublishDraft): Promise<PublishDraft> {
  const keys = draft.images.filter((image) => !image.id).map((image) => image.key)
  if (!keys.length) return draft
  const db = await openDb()
  if (!db) return draft
  try {
    const blobs = await new Promise<Map<string, Blob>>((resolve) => {
      const result = new Map<string, Blob>()
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      for (const key of keys) {
        const request = store.get(key)
        request.onsuccess = () => {
          if (request.result instanceof Blob) result.set(key, request.result)
        }
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => resolve(result)
      tx.onabort = () => resolve(result)
    })
    return {
      ...draft,
      images: draft.images.map((image) =>
        image.id ? image : { ...image, blob: blobs.get(image.key) }
      )
    }
  } finally {
    db.close()
  }
}

export async function clearDraftBlobs(): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } finally {
    db.close()
  }
}

export function saveDraftMeta(draft: PublishDraft): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    localStorage.setItem(META_KEY, JSON.stringify(toStorableDraft({ ...draft, updatedAt: Date.now() })))
    return true
  } catch {
    return false
  }
}

export function loadDraftMeta(): PublishDraft | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isDraftUsable(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearDraftMeta(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(META_KEY)
  } catch {
    /* 忽略存储不可用 */
  }
}

/** 恢复完整草稿（元数据 + Blob）；无效/过期草稿返回 null */
export async function restoreDraft(): Promise<PublishDraft | null> {
  const meta = loadDraftMeta()
  if (!meta) return null
  return loadDraftBlobs(meta)
}

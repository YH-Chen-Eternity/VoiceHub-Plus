import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/**
 * 社区 / 公告图片的私有文件存储。
 *
 * 背景：运行时上传的图片不能放 public（Nitro 资源清单在构建期烘焙，运行时新增文件一律 404），
 * 也不能放进任何可被 Web 服务器直接映射的 CDN / 静态目录——否则未审核、已删除帖子的图片
 * 会被绕过鉴权直接访问。因此所有图片字节统一落在进程私有数据目录，只由 /api/media/[id]
 * 做完可见性校验后再读取返回。
 *
 * 数据库只保存相对路径（storagePath / previewPath），绝对根目录由 MEDIA_STORAGE_DIR 决定，
 * 生产通过持久化卷挂载；换主机 / 换容器只要卷在即可，不把绝对路径写进数据库。
 *
 * 安全不变量：
 * - 文件名一律由服务端按「数据库 id + 内容 sha256 分片」生成，绝不用客户端 filename 拼路径；
 * - 读写前用 SAFE_RELATIVE_PATH 白名单校验，并二次确认 resolve 后仍在根目录内，杜绝 ../ 逃逸；
 * - 原子写入（临时文件 + rename），避免并发读到半成品；文件 0o600、目录 0o700；
 * - 读取失败 / 路径非法一律返回 null，由端点统一 404，不向客户端泄露内部路径。
 */

const DEFAULT_DIR = './data/media'
const DIR_MODE = 0o700
const FILE_MODE = 0o600
// 仅允许：2 级十六进制分片目录 + 数字 id + 可选 _preview + .webp
const SAFE_RELATIVE_PATH = /^[0-9a-f]{2}\/[0-9a-f]{2}\/\d+(_preview)?\.webp$/

let cachedRoot: string | null = null

/** 私有存储根目录（进程内缓存一次；env 在运行期不变） */
export function getMediaStorageRoot(): string {
  if (cachedRoot) return cachedRoot
  const configured = String(process.env.MEDIA_STORAGE_DIR || '').trim()
  cachedRoot = resolve(configured || DEFAULT_DIR)
  return cachedRoot
}

/** 由服务端生成稳定的相对路径；分片取 sha256 前 4 位，避免单目录文件过多 */
export function buildMediaRelativePaths(
  id: number,
  sha256: string
): { storagePath: string; previewPath: string } {
  const digest = String(sha256 || '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
    .padEnd(4, '0')
  const shard = `${digest.slice(0, 2)}/${digest.slice(2, 4)}`
  return {
    storagePath: `${shard}/${id}.webp`,
    previewPath: `${shard}/${id}_preview.webp`
  }
}

/** 校验并解析为根目录下的绝对路径；非法返回 null */
function resolveWithinRoot(relativePath: string): string | null {
  if (!SAFE_RELATIVE_PATH.test(relativePath)) return null
  const root = getMediaStorageRoot()
  const full = resolve(root, relativePath)
  if (!full.startsWith(`${root}/`)) return null
  return full
}

/** 原子写入单文件：先写 .tmp 再 rename，权限 0o600 */
async function writeAtomic(relativePath: string, data: Buffer): Promise<void> {
  const full = resolveWithinRoot(relativePath)
  if (!full) throw new Error('MEDIA_STORAGE_PATH_INVALID')
  await mkdir(dirname(full), { recursive: true, mode: DIR_MODE })
  const tmp = `${full}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tmp, data, { mode: FILE_MODE, flag: 'wx' })
    await rename(tmp, full)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

/**
 * 写入原图与可选预览图（社区图片有预览，公告图片没有）。
 * 预览写入失败不阻断上传：previewPath 返回空串，端点会降级为直接返回原图。
 */
export async function saveMediaFiles(params: {
  id: number
  sha256: string
  original: Buffer
  preview?: Buffer | null
}): Promise<{ storagePath: string; previewPath: string }> {
  const paths = buildMediaRelativePaths(params.id, params.sha256)
  await writeAtomic(paths.storagePath, params.original)
  if (!params.preview) {
    return { storagePath: paths.storagePath, previewPath: '' }
  }
  try {
    await writeAtomic(paths.previewPath, params.preview)
    return paths
  } catch (error) {
    console.warn('[media-storage] 预览图写入失败，将回退原图:', error)
    return { storagePath: paths.storagePath, previewPath: '' }
  }
}

/** 读取私有图片文件；路径非法或文件不存在返回 null（端点据此 404） */
export async function readMediaFile(
  relativePath: string | null | undefined
): Promise<Buffer | null> {
  if (!relativePath) return null
  const full = resolveWithinRoot(relativePath)
  if (!full) return null
  try {
    return await readFile(full)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[media-storage] 读取图片文件失败:', relativePath, error?.message)
    }
    return null
  }
}

/** 删除图片文件（归档清理 / 立即删除时调用）；失败仅记录，不阻断主流程 */
export async function deleteMediaFiles(
  paths: Array<string | null | undefined>
): Promise<void> {
  for (const relativePath of paths) {
    if (!relativePath) continue
    const full = resolveWithinRoot(relativePath)
    if (!full) continue
    await unlink(full).catch((error: any) => {
      if (error?.code !== 'ENOENT') {
        console.warn('[media-storage] 删除图片文件失败:', relativePath, error?.message)
      }
    })
  }
}

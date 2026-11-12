/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 騰訊雲 Lighthouse（輕量應用伺服器）流量包查詢封裝。
 * 用於運維看板「資源包 總量 / 已用 / 剩餘」的真實雲端口徑。
 *
 * 安全：
 *   - 密鑰只從 env 讀（與 tencentMonitor.ts 共用 TENCENT_SECRET_ID /
 *     TENCENT_SECRET_KEY），不入庫、不寫檔、不硬編、不進回應、不打日誌；
 *   - TC3-HMAC-SHA256 簽章以 node:crypto 純 TS 實作，不引 SDK、不引新依賴；
 *   - Lighthouse 是騰訊雲公開 API endpoint（非本站域名），endpoint 可用 env 覆蓋；
 *   - 未配置環境變數、簽章或 HTTP 失敗一律降級 available:false，不拋到端點。
 *
 * env：
 *   TENCENT_SECRET_ID / TENCENT_SECRET_KEY   必填（最小權限子帳號，僅
 *                                            lighthouse:DescribeInstancesTrafficPackages）
 *   LIGHTHOUSE_REGION                        必填，輕量伺服器實例所在地域
 *   LIGHTHOUSE_INSTANCE_ID                   必填，輕量伺服器實例 ID
 *   LIGHTHOUSE_ENDPOINT                      選填，預設官方公開 endpoint
 *
 * 未配置任一必填項時整體降級 available:false，不影響看板其他區塊。
 *
 * 成本控制：成功結果記憶體快取 5 分鐘，避免看板輪詢打爆配額查詢。
 */
import { createHash, createHmac } from 'node:crypto'
import axios from 'axios'

/** 每次调用时读取 env（而非模块加载时缓存），避免运行时改动不生效。 */
function readConfig() {
  return {
    SECRET_ID: String(process.env.TENCENT_SECRET_ID || '').trim(),
    SECRET_KEY: String(process.env.TENCENT_SECRET_KEY || '').trim(),
    INSTANCE_ID: String(process.env.LIGHTHOUSE_INSTANCE_ID || '').trim(),
    REGION: String(process.env.LIGHTHOUSE_REGION || '').trim(),
    HOST: String(
      process.env.LIGHTHOUSE_ENDPOINT || 'lighthouse.tencentcloudapi.com'
    ).trim()
  }
}

const SERVICE = 'lighthouse'
const ACTION = 'DescribeInstancesTrafficPackages'
const VERSION = '2020-03-24'
const REQUEST_TIMEOUT_MS = 4500
const CACHE_TTL_MS = 5 * 60 * 1000
const WARN_INTERVAL_MS = 60_000

let cache: { at: number; data: LighthouseTrafficPackage } | null = null
// ⚠️ cache 為進程內單例：當前生產為單容器單進程，即全域緩存；
// 若未來多實例（PM2 cluster 等），各進程各自緩存、各自查詢（5 分鐘窗口內重複），
// 功能正確僅查詢量增加；如需去重請改 Redis 共享緩存。
let lastWarnAt = 0

function warnThrottled(...args: unknown[]) {
  const now = Date.now()
  if (now - lastWarnAt < WARN_INTERVAL_MS) return
  lastWarnAt = now
  console.warn(...args)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

/** 產生 TC3-HMAC-SHA256 的 Authorization（與 tencentMonitor.ts 同一套規範）。 */
function buildAuthorization(cfg: ReturnType<typeof readConfig>, payload: string, timestamp: number): string {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\nhost:${cfg.HOST}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload)
  ].join('\n')
  const credentialScope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const secretDate = hmac(`TC3${cfg.SECRET_KEY}`, date)
  const secretService = hmac(secretDate, SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex')
  return `TC3-HMAC-SHA256 Credential=${cfg.SECRET_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export interface LighthouseTrafficPackage {
  available: boolean
  /** 流量包總量（字節） */
  total: number | null
  /** 本週期已用（字節） */
  used: number | null
  /** 本週期剩餘（字節） */
  remaining: number | null
  /** 計費週期開始（ISO8601） */
  periodStart: string | null
  /** 計費週期結束／重置時間（ISO8601） */
  periodEnd: string | null
  /** 實例 ID（脫敏展示用） */
  instanceId: string
}

const EMPTY: LighthouseTrafficPackage = {
  available: false,
  total: null,
  used: null,
  remaining: null,
  periodStart: null,
  periodEnd: null,
  instanceId: ''
}

/**
 * 查詢輕量伺服器流量包餘量（取第一個流量包；輕量主機常規只有一個）。
 * 失敗一律降級 available:false，不拋到端點。
 */
export async function getLighthouseTrafficPackage(): Promise<LighthouseTrafficPackage> {
  const cfg = readConfig()
  const missingEnv = ([
    ['SECRET_ID', 'TENCENT_SECRET_ID'],
    ['SECRET_KEY', 'TENCENT_SECRET_KEY'],
    ['INSTANCE_ID', 'LIGHTHOUSE_INSTANCE_ID'],
    ['REGION', 'LIGHTHOUSE_REGION']
  ] as const)
    .filter(([key]) => !cfg[key])
    .map(([, name]) => name)
  if (missingEnv.length) {
    warnThrottled(`[lighthouse-traffic] 缺少必填 env：${missingEnv.join(' / ')}，流量包查詢降級`)
    return { ...EMPTY }
  }
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data

  const payload = JSON.stringify({ InstanceIds: [cfg.INSTANCE_ID] })
  const timestamp = Math.floor(Date.now() / 1000)
  const authorization = buildAuthorization(cfg, payload, timestamp)
  // 規範化 endpoint：HOST 若被誤配成含路徑/協議的值，收斂為 origin，避免拼接出異常地址
  let endpoint: string
  try {
    endpoint = new URL('/', `https://${cfg.HOST}`).href
  } catch {
    warnThrottled('[lighthouse-traffic] LIGHTHOUSE_ENDPOINT 非法域名，降級')
    return { ...EMPTY }
  }

  try {
    const response = await axios.post<any>(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Host: cfg.HOST,
        Authorization: authorization,
        'X-TC-Action': ACTION,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': VERSION,
        'X-TC-Region': cfg.REGION
      },
      timeout: REQUEST_TIMEOUT_MS,
      proxy: false,
      validateStatus: (status) => status >= 200 && status < 300
    })
    const body = response.data
    if (body?.Response?.Error) {
      throw new Error(String(body.Response.Error.Code || 'LighthouseError'))
    }
    const instanceSet = body?.Response?.InstanceTrafficPackageSet
    const pkgSet = Array.isArray(instanceSet) && instanceSet.length
      ? instanceSet[0]?.TrafficPackageSet
      : undefined
    if (!Array.isArray(pkgSet)) throw new Error('實例不存在或無流量包（InstanceTrafficPackageSet 為空）')
    const pkg = pkgSet[0]
    if (!pkg) throw new Error('實例未開通流量包（TrafficPackageSet 為空）')
    const data: LighthouseTrafficPackage = {
      available: true,
      total: Number(pkg.TrafficPackageTotal) || 0,
      used: Number(pkg.TrafficUsed) || 0,
      remaining: Number(pkg.TrafficPackageRemaining) || 0,
      periodStart: pkg.StartTime ? String(pkg.StartTime) : null,
      periodEnd: pkg.EndTime ? String(pkg.EndTime) : null,
      instanceId: cfg.INSTANCE_ID
    }
    cache = { at: Date.now(), data }
    return data
  } catch (error) {
    warnThrottled('[lighthouse-traffic] DescribeInstancesTrafficPackages 失敗，降級:', errorMessage(error))
    return { ...EMPTY }
  }
}

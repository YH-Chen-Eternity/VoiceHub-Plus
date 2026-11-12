/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 騰訊雲監控（GetMonitorData）唯讀封裝，用於取得 COS 官方出站流量。
 *
 * 安全：
 *   - 子帳號金鑰只從 env 讀（TENCENT_SECRET_ID / TENCENT_SECRET_KEY），
 *     不入庫、不寫檔、不硬編、不進回應、不打日誌；
 *   - TC3-HMAC-SHA256 簽章以 node:crypto 純 TS 實作，不引 SDK、不引新依賴；
 *   - 雲監控是騰訊雲公開 API endpoint（非本站域名），可用 env 覆蓋；
 *   - 未配置金鑰、簽章或 HTTP 失敗一律降級 available:false，不拋到端點。
 *
 * env：
 *   TENCENT_SECRET_ID / TENCENT_SECRET_KEY   必填（唯讀子帳號）
 *   TENCENT_COS_BUCKET                       選填，Instances.Dimensions 的 bucket
 *   TENCENT_COS_REGION                      選填
 *   TENCENT_MONITOR_ENDPOINT                 選填，預設官方公開 endpoint
 *
 * ⚠️ 待實測校正：InternetTraffic 的維度名稱（bucket / appid / region）、
 *    Values 的單位（byte / MB）與 Period 上限，請部署時依實際回應調整。
 */
import { createHash, createHmac } from 'node:crypto'
import axios from 'axios'

const SECRET_ID = String(process.env.TENCENT_SECRET_ID || '').trim()
const SECRET_KEY = String(process.env.TENCENT_SECRET_KEY || '').trim()
const HOST = String(
  process.env.TENCENT_MONITOR_ENDPOINT || 'monitor.tencentcloudapi.com'
).trim()
const BUCKET = String(process.env.TENCENT_COS_BUCKET || '').trim()
const REGION = String(process.env.TENCENT_COS_REGION || '').trim()

const SERVICE = 'monitor'
const ACTION = 'GetMonitorData'
const VERSION = '2018-07-24'
const NAMESPACE = 'qce/cos'
const METRIC = 'InternetTraffic'
const REQUEST_TIMEOUT_MS = 4500
const WARN_INTERVAL_MS = 60_000
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000

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

/** 產生 TC3-HMAC-SHA256 的 Authorization 與 credential scope 日期。 */
function buildAuthorization(payload: string, timestamp: number): string {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\nhost:${HOST}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload)
  ].join('\n')
  // canonicalHeaders 自帶結尾換行，join 會再補一個 '\n'，符合
  // CanonicalHeaders 與 SignedHeaders 之間的那一行空白。
  const credentialScope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const secretDate = hmac(`TC3${SECRET_KEY}`, date)
  const secretService = hmac(secretDate, SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex')
  return `TC3-HMAC-SHA256 Credential=${SECRET_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
}

/** 北京時間（UTC+8，無 DST）牆鐘轉雲 API 需要的 ISO8601（+08:00，不含毫秒）。 */
function beijingIso(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 19) + '+08:00'
}
function beijingStartOfDay(now: Date): Date {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - SHANGHAI_OFFSET_MS)
}
function beijingStartOfMonth(now: Date): Date {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  shifted.setUTCDate(1)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - SHANGHAI_OFFSET_MS)
}

/** 呼叫一次 GetMonitorData，回傳該區間 Values 的總和；失敗回傳 null。 */
async function fetchTraffic(
  startTime: Date,
  endTime: Date,
  period: number
): Promise<number | null> {
  const payloadObject: Record<string, unknown> = {
    Namespace: NAMESPACE,
    MetricName: METRIC,
    Period: period,
    StartTime: beijingIso(startTime),
    EndTime: beijingIso(endTime)
  }
  if (BUCKET) {
    const dimensions: { Name: string; Value: string }[] = [
      { Name: 'bucket', Value: BUCKET }
    ]
    if (REGION) dimensions.push({ Name: 'region', Value: REGION })
    payloadObject.Instances = [{ Dimensions: dimensions }]
  }
  const payload = JSON.stringify(payloadObject)
  const timestamp = Math.floor(Date.now() / 1000)
  const authorization = buildAuthorization(payload, timestamp)

  try {
    const response = await axios.post<any>(`https://${HOST}/`, payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Host: HOST,
        Authorization: authorization,
        'X-TC-Action': ACTION,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': VERSION,
        ...(REGION ? { 'X-TC-Region': REGION } : {})
      },
      timeout: REQUEST_TIMEOUT_MS,
      proxy: false,
      validateStatus: (status) => status >= 200 && status < 300
    })
    const body = response.data
    if (body?.Response?.Error) {
      throw new Error(String(body.Response.Error.Code || 'MonitorError'))
    }
    const points = body?.Response?.DataPoints
    const values = Array.isArray(points) ? points[0]?.Values : undefined
    if (!Array.isArray(values)) throw new Error('DataPoints.Values 缺失')
    return values.reduce((sum: number, value: unknown) => sum + (Number(value) || 0), 0)
  } catch (error) {
    warnThrottled('[tencent-monitor] GetMonitorData 失敗，降級:', errorMessage(error))
    return null
  }
}

export interface CosOfficialTraffic {
  available: boolean
  today: number
  month: number
  /** 雲監控回傳的數值單位，需部署時實測確認（契約未定義）。 */
  unit: string
}

/** 取得「本日」與「本月」的 COS 官方出站流量；任一失敗即整體降級。 */
export async function getCosOfficialTraffic(): Promise<CosOfficialTraffic> {
  const empty: CosOfficialTraffic = {
    available: false,
    today: 0,
    month: 0,
    unit: 'as-returned-by-monitor'
  }
  if (!SECRET_ID || !SECRET_KEY) return empty

  const now = new Date()
  const [today, month] = await Promise.all([
    fetchTraffic(beijingStartOfDay(now), now, 3600),
    fetchTraffic(beijingStartOfMonth(now), now, 86400)
  ])
  if (today === null || month === null) return empty
  return {
    available: true,
    today: Math.max(0, today),
    month: Math.max(0, month),
    unit: empty.unit
  }
}

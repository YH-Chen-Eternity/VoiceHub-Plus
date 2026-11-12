/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 雷池 Open API 的「只讀」封裝。
 *
 * 本檔刻意只提供 GET：看板純唯讀，不做任何雷池設定／封禁／規則寫入。
 * 任何新增方法都必須維持 GET，不得加入 POST/PUT/DELETE。
 *
 * env：
 *   SAFELINE_API_BASE    預設 https://127.0.0.1:9443（本機迴環，雷池預設自簽）
 *   SAFELINE_API_TOKEN   送至 X-SLCE-API-TOKEN 的權杖（相容別名 X_SLCE_API_TOKEN）
 *   SAFELINE_API_CA_FILE 可選：雷池自簽憑證的 CA / PEM 路徑，用於在嚴格校驗下信任該憑證。
 *
 * 憑證處理：預設使用 Node 的系統信任鏈並**嚴格校驗**，不會關閉憑證驗證、
 *   不改 axios 全域預設、也不設定任何全域 TLS 開關。
 *   雷池使用自簽憑證時，把其 CA 憑證路徑填入 SAFELINE_API_CA_FILE；
 *   該 CA 只作用於本模組的請求，不影響行程內其它 HTTPS 呼叫。
 *   未設定或憑證不可信時，Open API 資料源降級 available:false，看板不會 500。
 */
import https from 'node:https'
import { readFileSync } from 'node:fs'
import axios from 'axios'

const BASE = String(process.env.SAFELINE_API_BASE || 'https://127.0.0.1:9443').replace(/\/+$/, '')
const TOKEN = String(
  process.env.SAFELINE_API_TOKEN || process.env.X_SLCE_API_TOKEN || ''
).trim()
const CA_FILE = String(process.env.SAFELINE_API_CA_FILE || '').trim()
const REQUEST_TIMEOUT_MS = 3000
const WARN_INTERVAL_MS = 60_000

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

// 可選的自訂 CA：嚴格校驗 + 信任雷池自簽憑證，只作用於本模組的請求。
let trustedCaAgent: https.Agent | null = null
if (CA_FILE) {
  try {
    trustedCaAgent = new https.Agent({ ca: readFileSync(CA_FILE, 'utf8') })
  } catch (error) {
    console.warn('[safeline-api] SAFELINE_API_CA_FILE 讀取失敗，改用系統預設信任鏈:', errorMessage(error))
  }
}

/**
 * 雷池 Open API 唯讀端點。⚠️ 路徑需依實際版本實測後校正
 * （契約僅提示 /api/open/system 等，未給完整清單）。
 */
export const SAFELINE_STATE_ENDPOINTS = {
  system: '/api/open/system',
  license: '/api/open/license',
  sites: '/api/open/site',
  cert: '/api/open/cert',
  cc: '/api/open/protect/cc'
} as const

export interface SafelineResult<T> {
  available: boolean
  data: T | null
}

/** 唯一對外呼叫：GET + 3s 逾時 + token header；失敗降級 available:false，不拋錯。 */
export async function safelineRequest<T = any>(path: string): Promise<SafelineResult<T>> {
  if (!TOKEN) return { available: false, data: null }
  const safePath = String(path || '').replace(/^\/+/, '')
  if (!safePath.startsWith('api/')) {
    // 限制在 Open API 命名空間，避免誤呼叫到設定／寫入類路徑。
    return { available: false, data: null }
  }
  const url = `${BASE}/${safePath}`
  try {
    const response = await axios.get<T>(url, {
      headers: {
        'X-SLCE-API-TOKEN': TOKEN,
        Accept: 'application/json'
      },
      timeout: REQUEST_TIMEOUT_MS,
      ...(BASE.startsWith('https://') && trustedCaAgent
        ? { httpsAgent: trustedCaAgent, proxy: false }
        : {}),
      validateStatus: (status) => status >= 200 && status < 300
    })
    return { available: true, data: response.data }
  } catch (error) {
    warnThrottled('[safeline-api] 只讀請求失敗，降級:', safePath, errorMessage(error))
    return { available: false, data: null }
  }
}

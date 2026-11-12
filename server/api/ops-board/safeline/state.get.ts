/**
 * 雷池狀態（唯讀 Open API）。每個欄位獨立容錯，全部失敗降級 available:false。
 * ⚠️ 端點路徑與回應欄位鍵需依雷池版本實測校正（見 safeline.ts 的
 *    SAFELINE_STATE_ENDPOINTS 與本檔 pick() 的候選鍵）。
 */
import { defineEventHandler } from 'h3'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import {
  safelineRequest,
  SAFELINE_STATE_ENDPOINTS
} from '~~/server/utils/safeline'
import { setOpsBoardNoStore } from '../_shared'

function pick(source: any, paths: string[]): unknown {
  for (const path of paths) {
    let node = source
    for (const key of path.split('.')) {
      if (node === null || node === undefined || typeof node !== 'object') {
        node = undefined
        break
      }
      node = node[key]
    }
    if (node !== undefined && node !== null && node !== '') return node
  }
  return null
}

function asString(value: unknown): string | null {
  return value === null ? null : String(value).slice(0, 200)
}

function asNumber(value: unknown): number | null {
  const number = Number(value)
  return value === null || !Number.isFinite(number) ? null : number
}

function countArray(source: any): number | null {
  for (const key of ['list', 'sites', 'data', 'items']) {
    const node = source?.[key] ?? source?.data?.[key]
    if (Array.isArray(node)) return node.length
  }
  return null
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setOpsBoardNoStore(event)

  const [system, license, sites, cert, cc] = await Promise.all([
    safelineRequest(SAFELINE_STATE_ENDPOINTS.system),
    safelineRequest(SAFELINE_STATE_ENDPOINTS.license),
    safelineRequest(SAFELINE_STATE_ENDPOINTS.sites),
    safelineRequest(SAFELINE_STATE_ENDPOINTS.cert),
    safelineRequest(SAFELINE_STATE_ENDPOINTS.cc)
  ])
  const results = [system, license, sites, cert, cc]
  const available = results.some((result) => result.available)

  return {
    available,
    partial: available && !results.every((result) => result.available),
    version: asString(pick(system.data, ['version', 'data.version', 'Version', 'data.Version'])),
    license: asString(
      pick(license.data, ['license', 'data.license', 'type', 'data.type', 'License', 'data.License'])
    ),
    sites:
      asNumber(pick(sites.data, ['total', 'data.total', 'count', 'data.count'])) ??
      countArray(sites.data),
    certExpiry: asString(
      pick(cert.data, [
        'expiry',
        'data.expiry',
        'expireAt',
        'data.expireAt',
        'notAfter',
        'data.notAfter'
      ])
    ),
    ccThreshold: asNumber(
      pick(cc.data, ['threshold', 'data.threshold', 'qps', 'data.qps', 'data.limit'])
    ),
    capacity: asNumber(pick(system.data, ['capacity', 'data.capacity', 'qps', 'data.qps']))
  }
})

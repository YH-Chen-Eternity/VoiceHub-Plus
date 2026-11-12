/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 主機指標（CPU／記憶體／網卡流量）唯讀檔案例。
 *
 * ┌─ 採集器檔案格式約定（部署階段主 agent 請按此格式安裝）──────────────┐
 * │ 根目錄：/data/voicehub/host-metrics/                                  │
 * │         （可用 env HOST_METRICS_DIR 覆蓋；需以唯讀掛載進應用容器）    │
 * │                                                                      │
 * │ latest.json —— 單一 JSON 物件：                                       │
 * │   { "ts": 1731369600000,   // epoch 毫秒                             │
 * │     "cpuPct": 12.5,        // 0~100                                  │
 * │     "memPct": 43.2,        // 0~100                                  │
 * │     "netRxBps": 204800,    // byte/s                                 │
 * │     "netTxBps": 51200 }    // byte/s                                 │
 * │                                                                      │
 * │ <粒度>/YYYY-MM-DD.jsonl —— 每行一個與 latest.json 同結構的 JSON 物件； │
 * │   粒度目錄固定為 5s / 1min / 10min / 1h，由採集器自行輪轉、按日期分片。│
 * │   看板依 range 選擇粒度：24h→10min，7d/30d/1y/all→1h；              │
 * │   5s 與 1min 目錄保留給即時檢視（本輪端點未使用）。                   │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 目錄未掛載、檔案不存在、單行 JSON 損壞 → 一律降級 available:false 或略過該行，
 * 絕不拋錯、絕不讓看板 500。目錄名稱全部來自固定常數，檔名以白名單過濾，
 * 不接受任何外部路徑輸入。
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = String(process.env.HOST_METRICS_DIR || '/data/voicehub/host-metrics')
const MAX_SERIES_POINTS = 240
const JSONL_NAME = /^\d{4}-\d{2}-\d{2}\.jsonl$/

const RANGE_GRANULARITY: Record<string, string> = {
  '24h': '10min',
  '7d': '1h',
  '30d': '1h',
  '1y': '1h',
  all: '1h'
}

export interface HostMetricPoint {
  ts: number
  cpuPct: number
  memPct: number
  netRxBps: number
  netTxBps: number
}
export interface HostMetricSeriesPoint {
  ts: number
  cpu: number
  memory: number
  netRx: number
  netTx: number
}
export interface HostMetricsResult {
  available: boolean
  cpu: number | null
  memory: number | null
  netRx: number | null
  netTx: number | null
  series: HostMetricSeriesPoint[]
  granularity: string | null
  latestTs: number | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function finite(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalize(raw: unknown): HostMetricPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const ts = Number(value.ts)
  if (!Number.isFinite(ts) || ts <= 0) return null
  const clampPct = (n: number) => Math.min(100, Math.max(0, n))
  return {
    ts,
    cpuPct: clampPct(finite(value.cpuPct)),
    memPct: clampPct(finite(value.memPct)),
    netRxBps: Math.max(0, finite(value.netRxBps)),
    netTxBps: Math.max(0, finite(value.netTxBps))
  }
}

async function readLatest(): Promise<HostMetricPoint | null> {
  try {
    const raw = await readFile(path.join(ROOT, 'latest.json'), 'utf8')
    return normalize(JSON.parse(raw))
  } catch {
    return null
  }
}

function toSeriesPoint(point: HostMetricPoint): HostMetricSeriesPoint {
  return {
    ts: point.ts,
    cpu: point.cpuPct,
    memory: point.memPct,
    netRx: point.netRxBps,
    netTx: point.netTxBps
  }
}

function downsample(points: HostMetricPoint[]): HostMetricPoint[] {
  if (points.length <= MAX_SERIES_POINTS) return points
  const step = points.length / MAX_SERIES_POINTS
  const result: HostMetricPoint[] = []
  for (let i = 0; i < MAX_SERIES_POINTS; i++) {
    result.push(points[Math.floor(i * step)])
  }
  return result
}

async function readSeries(
  granularity: string,
  startTime: Date | null
): Promise<HostMetricPoint[]> {
  const directory = path.join(ROOT, granularity)
  // 目錄不存在／不可讀時降級為空列表（與看板其餘資料源一致），不拋錯。
  const entries = await readdir(directory).catch(() => [] as string[])
  const files = entries.filter((name) => JSONL_NAME.test(name)).sort()

  const since = startTime ? startTime.getTime() : 0
  const points: HostMetricPoint[] = []
  for (const name of files) {
    // 只讀取落在查詢範圍內的日期分片，避免掃描整年的檔案。
    const dayStart = Date.parse(`${name.slice(0, 10)}T00:00:00Z`)
    if (Number.isFinite(dayStart) && dayStart + 24 * 3600 * 1000 < since) continue
    try {
      const raw = await readFile(path.join(directory, name), 'utf8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const point = normalize(JSON.parse(line))
          if (point && point.ts >= since) points.push(point)
        } catch {
          // 單行損壞略過，不影響其餘資料
        }
      }
    } catch (error) {
      console.warn('[host-metrics] 分片讀取失敗，略過:', name, errorMessage(error))
    }
  }
  points.sort((a, b) => a.ts - b.ts)
  return downsample(points)
}

/** 讀取最新值與指定 range 的歷史曲線；任何檔案問題都降級，不拋錯。 */
export async function readHostMetrics(
  range: string,
  startTime: Date | null
): Promise<HostMetricsResult> {
  const granularity = RANGE_GRANULARITY[range] || '1h'
  try {
    const [latest, points] = await Promise.all([
      readLatest(),
      readSeries(granularity, startTime)
    ])
    const head = latest || points[points.length - 1] || null
    return {
      available: Boolean(latest || points.length),
      cpu: head ? head.cpuPct : null,
      memory: head ? head.memPct : null,
      netRx: head ? head.netRxBps : null,
      netTx: head ? head.netTxBps : null,
      series: points.map(toSeriesPoint),
      granularity,
      latestTs: latest ? latest.ts : null
    }
  } catch (error) {
    console.warn('[host-metrics] 讀取失敗，降級 available:false:', errorMessage(error))
    return {
      available: false,
      cpu: null,
      memory: null,
      netRx: null,
      netTx: null,
      series: [],
      granularity,
      latestTs: null
    }
  }
}

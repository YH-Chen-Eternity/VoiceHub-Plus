/* OpsBoard 看板專用格式化與資料正規化（純 JS，無外部依賴）
 * 後端欄位以 CONTRACT.md 為準；此處對契約未明確定義的回傳形狀做容錯，
 * 讓前端在 Agent G 回傳結構略有差異時仍能降級顯示，不拋到全局。 */

export const SERIES_LABELS = {
  requests: '请求', pv: 'PV', uv: 'UV', blocked: '拦截', attacks: '攻击',
  qps: 'QPS', value: '数值', count: '次数', ip: '独立 IP',
  inbound: '入站', outbound: '出站', rx: '下行', tx: '上行'
}

export const SERIES_COLORS = ['#3b82f6', '#f87171', '#34d399', '#22d3ee', '#a78bfa', '#fbbf24']

export function toNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  return undefined
}

// 整數千分位
export function formatInt(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = toNumber(v, NaN)
  if (Number.isNaN(n)) return String(v)
  return Math.round(n).toLocaleString('zh-CN')
}

// 緊湊數字：依 <html lang> 選擇中文「萬/億」或英文 K/M/B。
// 看板目前以簡中為主，但仍尊重頁面語言，便於後續完整國際化。
function isEnglishLocale() {
  if (typeof document === 'undefined') return false
  const lang = String(document.documentElement?.lang || navigator?.language || 'zh-CN').toLowerCase()
  return !lang.startsWith('zh')
}

export function formatCount(v, digits = 1) {
  if (v === null || v === undefined || v === '') return '—'
  const n = toNumber(v, NaN)
  if (Number.isNaN(n)) return String(v)
  const abs = Math.abs(n)
  if (isEnglishLocale()) {
    if (abs >= 1e9) return (n / 1e9).toFixed(digits) + 'B'
    if (abs >= 1e6) return (n / 1e6).toFixed(digits) + 'M'
    if (abs >= 1e3) return (n / 1e3).toFixed(digits) + 'K'
    return formatInt(n)
  }
  if (abs >= 1e8) return (n / 1e8).toFixed(digits) + '亿'
  if (abs >= 1e4) return (n / 1e4).toFixed(digits) + '万'
  return formatInt(n)
}

// 位元組（輸入統一按 bytes）
export function formatBytes(v, digits = 1) {
  if (v === null || v === undefined || v === '') return '—'
  const b = toNumber(v, NaN)
  if (Number.isNaN(b)) return String(v)
  if (b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : digits) + ' ' + units[i]
}

// 速率（契約未定單位，按 bytes/s 處理）
export function formatRate(v) {
  if (v === null || v === undefined || v === '') return '—'
  const b = toNumber(v, NaN)
  if (Number.isNaN(b)) return String(v)
  if (b <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

// 比例：後端統一回傳百分數 0~100（overview 帶 rateUnit:'percent'，
// hostMetrics 的 cpuPct / memPct 亦為 0~100）。只有呼叫端明確傳入
// unit='ratio' 時才把 0~1 小數換算成百分數，避免 0.5% 被誤顯示成 50%。
export function asPercentValue(v, unit = 'percent') {
  const n = toNumber(v, NaN)
  if (Number.isNaN(n)) return null
  return unit === 'ratio' ? n * 100 : n
}

export function formatPercent(v, digits = 1, unit = 'percent') {
  const p = asPercentValue(v, unit)
  return p === null ? '—' : p.toFixed(digits) + '%'
}

export function formatDelta(v) {
  if (v === null || v === undefined || v === '') return null
  const n = toNumber(v, NaN)
  if (Number.isNaN(n)) return null
  return { value: n, text: (n >= 0 ? '+' : '') + n.toFixed(1) + '%', dir: n >= 0 ? 'up' : 'down' }
}

// 由 spark 資料估算「後半段 vs 前半段」環比（應用側估算）
export function deltaFromSeries(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return null
  const nums = arr.map((x) => toNumber(x, 0))
  const half = Math.max(1, Math.floor(nums.length / 2))
  const sum = (list) => list.reduce((a, b) => a + b, 0)
  const prev = sum(nums.slice(0, half))
  const cur = sum(nums.slice(half))
  if (prev <= 0) return null
  return formatDelta(((cur - prev) / prev) * 100)
}

// 時間
export function formatClock(d) {
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function formatDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 短時刻（峰值出現時間用）：當天只顯示時分，跨天補上「月-日」。
// now 可注入，便於測試跨天分支。
export function formatMomentShort(ms, now = Date.now()) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const current = new Date(now)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const sameDay =
    d.getFullYear() === current.getFullYear() &&
    d.getMonth() === current.getMonth() &&
    d.getDate() === current.getDate()
  if (sameDay) return `${hh}:${mm}`
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`
}

// 時段峰值在線：把後端 peak 物件翻成「數值 + 副標題」，
// 區間內無取樣時退化成「統計自 …」或「採樣啟動中」，避免顯示成 0 誤導。
export function describePeakOnline(peak, now = Date.now()) {
  const online = typeof peak?.online === 'number' ? peak.online : null
  if (online !== null && peak?.at) {
    return {
      value: online,
      text: formatCount(online),
      unit: '人',
      sub: `${formatMomentShort(peak.at, now)} 出现`,
      hasData: true
    }
  }
  const since = typeof peak?.since === 'number' ? peak.since : null
  return {
    value: null,
    text: '—',
    unit: '',
    sub: since ? `统计自 ${formatMomentShort(since, now)}` : '采样启动中',
    hasData: false
  }
}


// 時間軸標籤：epoch / ISO / 既有字串
function axisLabel(t) {
  if (typeof t === 'number') {
    const ms = t < 1e12 ? t * 1000 : t
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) {
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`
    }
  }
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t.replace(' ', 'T'))
    if (!Number.isNaN(d.getTime())) {
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`
    }
  }
  const s = String(t)
  return s.length > 12 ? s.slice(5) : s
}

// Top 榜容錯：(name/key + value/count) 或 [name, value]
const NAME_KEYS = [
  'name', 'label', 'ip', 'type', 'region', 'page', 'path', 'url', 'ua',
  'title', 'key', 'country', 'city', 'file', 'dimension'
]
const VALUE_KEYS = [
  'value', 'count', 'total', 'hits', 'num', 'requests', 'bytes', 'qty',
  'sum', 'times', 'score'
]

export function toTopItems(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((raw) => {
      if (raw === null || raw === undefined) return null
      if (Array.isArray(raw)) return { name: String(raw[0] ?? '—'), value: toNumber(raw[1], 0), raw }
      if (typeof raw !== 'object') return { name: String(raw), value: 0, raw }
      const name = pick(raw, NAME_KEYS) ?? '—'
      const value = pick(raw, VALUE_KEYS) ?? 0
      return { name: String(name), value: toNumber(value, 0), raw }
    })
    .filter(Boolean)
}

// 時序容錯：number[] | {name,data[]}[] | {t,requests,blocked,...}[]
export function toChart(input, options = {}) {
  const names = options.names || []
  const empty = { labels: [], series: [] }
  if (!Array.isArray(input) || input.length === 0) return empty

  // A：純數字陣列
  if (input.every((x) => typeof x === 'number')) {
    return {
      labels: input.map((_, i) => String(i + 1)),
      series: [{ name: names[0] || '数值', data: input.slice() }]
    }
  }

  // B：多序列 {name, data:number[]}
  if (input.every((x) => x && typeof x === 'object' && Array.isArray(x.data))) {
    const len = Math.max(0, ...input.map((x) => x.data.length))
    const baseLabels = Array.isArray(input[0].labels) ? input[0].labels : null
    return {
      labels: Array.from({ length: len }, (_, i) =>
        baseLabels ? String(baseLabels[i] ?? i + 1) : String(i + 1)
      ),
      series: input.map((s, i) => ({
        name: s.name ?? names[i] ?? `系列 ${i + 1}`,
        data: s.data.map((v) => toNumber(v, 0)),
        color: s.color || SERIES_COLORS[i % SERIES_COLORS.length]
      }))
    }
  }

  // C：時間點物件陣列
  const timeKeys = ['t', 'time', 'ts', 'label', 'date', 'bucket', 'hour', 'day', 'x', 'name']
  const labels = input.map((p, i) => {
    const t = pick(p, timeKeys)
    return t === undefined ? String(i + 1) : axisLabel(t)
  })
  const keys = []
  for (const p of input) {
    if (!p || typeof p !== 'object') continue
    for (const k of Object.keys(p)) {
      if (timeKeys.includes(k) || k === 'color' || k === 'labels') continue
      if (typeof p[k] === 'number' && !keys.includes(k)) keys.push(k)
    }
  }
  const series = keys.map((k, i) => ({
    name: SERIES_LABELS[k] || names[i] || k,
    data: input.map((p) => toNumber(p?.[k], 0)),
    color: SERIES_COLORS[i % SERIES_COLORS.length]
  }))
  return { labels, series }
}

// 從時序取單一指標的 spark 數字陣列（支援 {name,data}[] 形狀）
export function sparkOf(input, key) {
  if (!Array.isArray(input)) return []
  if (input.length && input.every((x) => x && Array.isArray(x.data))) {
    const s = input.find((x) => x.name === key) || input[0]
    return (s?.data || []).map((v) => toNumber(v, 0))
  }
  return input.map((p) => {
    if (typeof p === 'number') return p
    if (!p || typeof p !== 'object') return 0
    return toNumber(p[key] ?? p.value ?? p.count, 0)
  })
}

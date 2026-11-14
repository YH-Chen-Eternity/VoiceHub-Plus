<template>
  <div class="ob-shell">
    <!-- 頂部：標題 / 時間範圍 / 重新整理狀態 / 手動重新整理 -->
    <header class="ob-header">
      <div class="ob-brand">
        <span class="ob-logo" aria-hidden="true">◈</span>
        <div class="ob-brand-text">
          <h1 class="ob-title">运维数据看板</h1>
          <p class="ob-sub">VoiceHub · 安全与流量总览</p>
        </div>
        <span v-if="estimated" class="ob-badge ob-est" title="部分指标由应用侧日志估算">应用侧估算</span>
      </div>

      <div class="ob-controls">
        <div class="ob-tabs" role="tablist" aria-label="时间范围">
          <button
            v-for="r in ranges"
            :key="r.value"
            class="ob-tab"
            :class="{ active: range === r.value }"
            role="tab"
            :aria-selected="range === r.value"
            @click="changeRange(r.value)"
          >{{ r.label }}</button>
        </div>

        <div class="ob-meta">
          <span class="ob-live">
            <i class="ob-dot" :class="{ paused: isHidden }" />
            {{ isHidden ? '已暂停' : '实时' }}
          </span>
          <span class="ob-updated">更新于 {{ lastUpdatedText }}</span>
          <span v-if="hasAnyError" class="ob-warn-tag">部分数据更新失败 · 显示上次结果</span>
          <select class="ob-select" :value="pollMs" aria-label="轮询间隔" @change="changePoll(Number($event.target.value))">
            <option v-for="p in pollOptions" :key="p.value" :value="p.value">刷新 {{ p.label }}</option>
          </select>
          <button class="ob-btn" :disabled="refreshing" @click="manualRefresh">
            <span class="ob-refresh-icon" :class="{ 'ob-spin': refreshing }" aria-hidden="true">⟳</span>
            刷新
          </button>
        </div>
      </div>
    </header>

    <main class="ob-body">
      <!-- 核心指標：請求 / PV / UV / 獨立 IP / 攔截 / 攻擊 IP / 4xx / 5xx / QPS -->
      <section class="ob-metrics" aria-label="核心指标">
        <OpsBoardMetricCard v-for="m in metricCards" :key="m.label" v-bind="m" />
      </section>

      <div class="ob-grid">
        <!-- 即時線上人數 + 訪問與攔截時序 -->
        <div class="ob-cell ob-span-4"><OpsBoardOnlineNow /></div>

        <section class="ob-cell ob-span-8">
          <div class="ob-card ob-chart-card">
            <header class="ob-card-head">
              <h3 class="ob-card-title">访问与拦截时序</h3>
              <div class="ob-card-tools">
                <span v-if="estimated" class="ob-est">应用侧估算</span>
                <div class="ob-mini-tabs">
                  <button :class="{ active: chartType === 'line' }" @click="chartType = 'line'">折线</button>
                  <button :class="{ active: chartType === 'bar' }" @click="chartType = 'bar'">柱状</button>
                </div>
              </div>
            </header>
            <div v-if="errors.overview && !data.overview" class="ob-empty">数据暂不可用</div>
            <OpsBoardOpsChart
              v-else
              :type="chartType"
              :series="trafficChart.series"
              :labels="trafficChart.labels"
              :height="230"
              aria-label="访问与拦截时序图"
            />
          </div>
        </section>

        <!-- 攻擊類型分佈 / 攻擊 IP Top / 地域分佈 -->
        <section class="ob-cell ob-span-4">
          <div class="ob-card">
            <header class="ob-card-head">
              <h3 class="ob-card-title">攻击类型分布</h3>
              <span v-if="estimated" class="ob-est">应用侧估算</span>
            </header>
            <div v-if="errors.attacks && !data.attacks" class="ob-empty">数据暂不可用</div>
            <OpsBoardOpsChart
              v-else
              type="donut"
              :series="attackTypeChart.series"
              :labels="attackTypeChart.labels"
              :height="210"
              donut-label="攻击总数"
              aria-label="攻击类型分布环形图"
            />
          </div>
        </section>

        <div class="ob-cell ob-span-4">
          <OpsBoardTopList
            title="攻击 IP Top"
            :items="data.attacks?.ipTop"
            :estimated="estimated"
            color="#f87171"
            :empty-text="errors.attacks && !data.attacks ? '数据暂不可用' : '暂无数据'"
          />
        </div>

        <div class="ob-cell ob-span-4">
          <OpsBoardTopList
            title="地域分布"
            :items="data.attacks?.regions"
            :estimated="estimated"
            color="#22d3ee"
            :empty-text="errors.attacks && !data.attacks ? '数据暂不可用' : '暂无数据'"
          />
        </div>

        <!-- 受訪頁面 Top / UA 分佈 / 封禁名單 -->
        <div class="ob-cell ob-span-4">
          <OpsBoardTopList
            title="受访页面 Top"
            :items="data.pages?.pagesTop"
            :estimated="estimated"
            color="#3b82f6"
            :empty-text="errors.pages && !data.pages ? '数据暂不可用' : '暂无数据'"
          />
        </div>

        <div class="ob-cell ob-span-4">
          <OpsBoardTopList
            title="UA 分布"
            :items="data.pages?.uaTop"
            :estimated="estimated"
            color="#a78bfa"
            :empty-text="errors.pages && !data.pages ? '数据暂不可用' : '暂无数据'"
          />
        </div>

        <div class="ob-cell ob-span-4"><OpsBoardBanList /></div>

        <!-- 伺服器指標 / 騰訊雲流量與配額 -->
        <div class="ob-cell ob-span-6"><OpsBoardServerMetrics /></div>
        <div class="ob-cell ob-span-6"><OpsBoardTrafficQuota /></div>

        <!-- 雷池節點狀態（純唯讀）/ 日誌清理 -->
        <div class="ob-cell ob-span-6"><OpsBoardSafelineState /></div>
        <div class="ob-cell ob-span-6"><OpsBoardLogCleanup /></div>
      </div>

      <footer class="ob-footer">
        数据来源：应用侧日志 / 雷池 SafeLine / 主机采集器 / 腾讯云监控 · 口径以「应用侧估算」标注为准
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, provide, reactive, ref } from 'vue'
import {
  formatCount, formatPercent, toChart, toTopItems, sparkOf,
  deltaFromSeries, formatClock
} from './format.js'

// ---- 端點（Agent G 實作，全部 ?range=；cleanup 為 POST，不進輪詢）----
const endpoints = {
  overview: '/api/ops-board/overview',
  attacks: '/api/ops-board/attacks',
  pages: '/api/ops-board/pages',
  realtime: '/api/ops-board/realtime',
  serverMetrics: '/api/ops-board/server-metrics',
  traffic: '/api/ops-board/traffic',
  safeline: '/api/ops-board/safeline/state',
  settings: '/api/ops-board/settings'
}

const ranges = [
  { label: '24 小时', value: '24h' },
  { label: '一周', value: '7d' },
  { label: '一月', value: '30d' },
  { label: '一年', value: '1y' },
  { label: '全部', value: 'all' }
]
const pollOptions = [
  { label: '5 秒', value: 5000 },
  { label: '10 秒', value: 10000 },
  { label: '15 秒', value: 15000 }
]

const range = ref('24h')
const chartType = ref('line')
const pollMs = ref(10000)
const isHidden = ref(false)
const loading = ref(false)
const refreshing = ref(false)
const lastUpdated = ref(null)

const data = reactive({
  overview: null, attacks: null, pages: null, realtime: null,
  serverMetrics: null, traffic: null, safeline: null, settings: null
})
const errors = reactive({
  overview: false, attacks: false, pages: false, realtime: false,
  serverMetrics: false, traffic: false, safeline: false, settings: false
})

const estimated = computed(() => Boolean(data.overview?.estimated))
const hasAnyError = computed(() => Object.values(errors).some(Boolean))
const lastUpdatedText = computed(() => (lastUpdated.value ? formatClock(lastUpdated.value) : '—'))
const rangeLabel = computed(() => ranges.find((r) => r.value === range.value)?.label ?? '')

// ---- 統一 $fetch 封裝：GET 自動帶 ?range=，失敗回傳 null 不拋到全局 ----
async function request(path, opts = {}) {
  const { method = 'GET', body, query = {}, withRange } = opts
  const q = { ...query }
  const needRange = withRange ?? method === 'GET'
  if (needRange) q.range = range.value
  if (method === 'GET') q._ = Date.now() // 防止中間層快取，確保即時
  try {
    return await $fetch(path, {
      method,
      query: q,
      body,
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-store' }
    })
  } catch (e) {
    return null
  }
}

// 寫操作專用（LogCleanup），回傳結構化結果
async function post(path, body) {
  try {
    const res = await $fetch(path, {
      method: 'POST',
      body,
      headers: { 'Cache-Control': 'no-store' }
    })
    return { ok: true, data: res, message: '' }
  } catch (e) {
    return {
      ok: false,
      data: null,
      message: e?.data?.message || e?.data?.statusMessage || e?.statusMessage || '操作失败'
    }
  }
}

// 並發抓取所有端點；序號丟棄過期回應，失敗保留上次資料並標記
let seq = 0
async function refresh({ silent = false } = {}) {
  const mySeq = ++seq
  if (!silent) loading.value = true
  refreshing.value = true
  const keys = Object.keys(endpoints)
  const results = await Promise.all(
    keys.map(async (key) => [key, await request(endpoints[key])])
  )
  if (mySeq !== seq) return
  for (const [key, res] of results) {
    if (res === null) {
      errors[key] = true // 保留上次資料，讓卡片降級顯示
    } else {
      data[key] = res
      errors[key] = false
    }
  }
  lastUpdated.value = new Date()
  if (!silent) loading.value = false
  refreshing.value = false
}

const manualRefresh = () => refresh({ silent: false })

// ---- 輪詢調度：頁面隱藏暫停、恢復可見立即重刷 ----
let timer = null
function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
function startTimer() {
  stopTimer()
  if (isHidden.value) return
  timer = setInterval(() => refresh({ silent: true }), pollMs.value)
}
function onVisibilityChange() {
  isHidden.value = document.hidden
  if (document.hidden) {
    stopTimer()
  } else {
    refresh({ silent: true }) // 恢復可見立即刷新
    startTimer()
  }
}
function changePoll(v) {
  if (!pollOptions.some((p) => p.value === v)) return
  pollMs.value = v
  try { localStorage.setItem('opsBoard:pollMs', String(v)) } catch (e) { /* 忽略隱私模式 */ }
  startTimer()
}
function changeRange(v) {
  if (v === range.value) return
  range.value = v
  seq++ // 讓在途回應失效
  refresh()
  startTimer()
}

onMounted(async () => {
  try {
    const saved = Number(localStorage.getItem('opsBoard:pollMs'))
    if (pollOptions.some((p) => p.value === saved)) pollMs.value = saved
  } catch (e) { /* 忽略 */ }
  if (typeof document !== 'undefined') {
    isHidden.value = document.hidden
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  await refresh()
  startTimer()
})
onUnmounted(() => {
  stopTimer()
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})

// 供子元件 inject 的共享狀態
provide('opsBoardContext', {
  range, rangeLabel, data, errors, estimated, loading, refreshing, lastUpdated,
  pollMs, isHidden, request, post, refresh
})

// ---- 指標卡資料 ----
const trafficChart = computed(() => toChart(data.overview?.series, { names: ['请求', '拦截'] }))
const attackTypeChart = computed(() => {
  const items = toTopItems(data.attacks?.byType)
  return { labels: items.map((i) => i.name), series: [{ name: '攻击类型', data: items.map((i) => i.value) }] }
})

const metricCards = computed(() => {
  const o = data.overview || {}
  const fail = errors.overview && !data.overview
  const failRt = errors.realtime && !data.realtime
  const rt = data.realtime || {}
  // 后端统一返回百分数 0~100（overview 带 rateUnit:'percent'）；
  // 仅当后端明确改为 ratio 时才做 0~1 → 百分数换算，避免 0.5% 误显示成 50%。
  const rateUnit = o.rateUnit === 'ratio' ? 'ratio' : 'percent'
  const sparkReq = sparkOf(o.series, 'requests')
  const sparkBlocked = sparkOf(o.series, 'blocked')
  const base = (label, value, extra = {}) => ({
    label,
    value: fail ? '—' : value,
    estimated: estimated.value,
    unavailable: fail,
    ...extra
  })
  return [
    base('请求次数', formatCount(o.requests), { spark: sparkReq, delta: deltaFromSeries(sparkReq), accent: 'blue' }),
    base('PV', formatCount(o.pv), { accent: 'blue' }),
    base('UV', formatCount(o.uv), { accent: 'green' }),
    base('独立 IP', formatCount(o.uniqueIp), { accent: 'green' }),
    base('拦截次数', formatCount(o.blocked), { spark: sparkBlocked, delta: deltaFromSeries(sparkBlocked), accent: 'red' }),
    base('攻击 IP 数', formatCount(o.attackIp), { accent: 'amber' }),
    base('4xx 率', formatPercent(o.rate4xx, 1, rateUnit), { hint: '客户端错误占比', accent: 'amber' }),
    base('5xx 率', formatPercent(o.rate5xx, 1, rateUnit), { hint: '服务端错误占比', accent: 'red' }),
    {
      label: '实时 QPS',
      value: failRt && fail ? '—' : formatCount(rt.qpsRealtime ?? o.qps),
      estimated: estimated.value,
      unavailable: failRt && fail,
      hint: '每秒请求数',
      accent: 'cyan'
    }
  ]
})
</script>

<style>
/* ============================================================
   OpsBoard 看板設計系統（僅本頁使用，類雷池 SafeLine 深色卡片風）
   以 .ob- 前綴隔離，不影響 VoiceHub 後台既有頁面樣式。
   ============================================================ */
.ob-shell {
  --ob-bg: #0b1020;
  --ob-card: #131a2c;
  --ob-card-2: #0e1524;
  --ob-border: #232d47;
  --ob-text: #e6ecf7;
  --ob-muted: #8a97b4;
  --ob-blue: #3b82f6;
  --ob-cyan: #22d3ee;
  --ob-green: #34d399;
  --ob-red: #f87171;
  --ob-amber: #fbbf24;
  --ob-purple: #a78bfa;
  position: fixed;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 22px 40px;
  background: radial-gradient(1200px 600px at 18% -12%, rgba(59, 130, 246, .10), transparent 60%), var(--ob-bg);
  color: var(--ob-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}
.ob-shell * { box-sizing: border-box; }
.ob-shell::-webkit-scrollbar { width: 8px; }
.ob-shell::-webkit-scrollbar-track { background: transparent; }
.ob-shell::-webkit-scrollbar-thumb { background: #2a3654; border-radius: 8px; }

/* ---- Header ---- */
.ob-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px 24px; flex-wrap: wrap; margin-bottom: 22px;
}
.ob-brand { display: flex; align-items: center; gap: 12px; }
.ob-logo {
  width: 40px; height: 40px; flex-shrink: 0; border-radius: 11px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 22px; color: #fff;
  background: linear-gradient(135deg, #3b82f6, #22d3ee);
  box-shadow: 0 4px 18px rgba(59, 130, 246, .35);
}
.ob-brand-text { line-height: 1.2; }
.ob-title { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: .3px; }
.ob-sub { margin: 3px 0 0; font-size: 11px; color: var(--ob-muted); }
.ob-badge {
  font-size: 11px; padding: 3px 9px; border-radius: 20px; white-space: nowrap;
}
.ob-est {
  font-size: 10px; color: var(--ob-amber); border: 1px solid rgba(251, 191, 36, .32);
  background: rgba(251, 191, 36, .08); padding: 2px 8px; border-radius: 20px; white-space: nowrap;
}
.ob-controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ob-tabs {
  display: inline-flex; padding: 3px; gap: 2px; border-radius: 9px;
  background: var(--ob-card); border: 1px solid var(--ob-border);
}
.ob-tab {
  border: 0; background: transparent; color: var(--ob-muted); cursor: pointer;
  font-size: 12px; padding: 6px 12px; border-radius: 7px; transition: .18s; white-space: nowrap;
}
.ob-tab:hover { color: var(--ob-text); }
.ob-tab.active { background: rgba(59, 130, 246, .18); color: #8ab6ff; font-weight: 600; }
.ob-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--ob-muted); }
.ob-live { display: inline-flex; align-items: center; gap: 6px; }
.ob-dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--ob-green);
  box-shadow: 0 0 0 4px rgba(52, 211, 153, .14); animation: ob-pulse 2s infinite;
}
.ob-dot.paused { background: var(--ob-muted); box-shadow: none; animation: none; }
@keyframes ob-pulse { 50% { box-shadow: 0 0 0 7px rgba(52, 211, 153, 0); } }
.ob-warn-tag {
  color: var(--ob-amber); background: rgba(251, 191, 36, .08);
  border: 1px solid rgba(251, 191, 36, .25); border-radius: 6px; padding: 2px 8px;
}
.ob-select, .ob-btn {
  background: var(--ob-card); color: var(--ob-text); border: 1px solid var(--ob-border);
  border-radius: 8px; font-size: 12px; padding: 6px 10px; cursor: pointer; transition: .18s;
}
.ob-select:hover, .ob-btn:hover { border-color: #3b82f6; }
.ob-btn { display: inline-flex; align-items: center; gap: 6px; }
.ob-btn:disabled { opacity: .6; cursor: default; }
.ob-refresh-icon { display: inline-block; font-size: 15px; line-height: 1; }
.ob-spin { animation: ob-spin 1s linear infinite; }
@keyframes ob-spin { to { transform: rotate(360deg); } }

/* ---- 網格 ---- */
.ob-body { max-width: 1680px; margin: 0 auto; }
.ob-metrics {
  display: grid; gap: 14px; margin-bottom: 16px;
  grid-template-columns: repeat(auto-fill, minmax(186px, 1fr));
}
.ob-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }
.ob-cell { min-width: 0; display: flex; }
.ob-cell > * { flex: 1; min-width: 0; }
.ob-span-3 { grid-column: span 3; }
.ob-span-4 { grid-column: span 4; }
.ob-span-6 { grid-column: span 6; }
.ob-span-8 { grid-column: span 8; }
.ob-span-12 { grid-column: span 12; }

/* ---- 卡片 ---- */
.ob-card {
  height: 100%;
  background: var(--ob-card);
  border: 1px solid var(--ob-border);
  border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 2px 14px rgba(0, 0, 0, .16);
  display: flex; flex-direction: column;
}
.ob-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.ob-card-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--ob-text); }
.ob-card-tools { display: flex; align-items: center; gap: 10px; }
.ob-mini-tabs { display: inline-flex; gap: 2px; padding: 2px; border-radius: 7px; background: var(--ob-card-2); }
.ob-mini-tabs button {
  border: 0; background: transparent; color: var(--ob-muted); font-size: 11px;
  padding: 3px 9px; border-radius: 5px; cursor: pointer;
}
.ob-mini-tabs button.active { background: rgba(59, 130, 246, .18); color: #8ab6ff; }
.ob-chart-card { min-height: 280px; }
.ob-subtle { font-size: 11px; color: var(--ob-muted); }
.ob-empty {
  flex: 1; min-height: 90px; display: flex; align-items: center; justify-content: center;
  color: var(--ob-muted); font-size: 13px; text-align: center;
  border: 1px dashed var(--ob-border); border-radius: 8px; padding: 16px;
}
.ob-warn { color: var(--ob-amber); }

/* ---- 共用小零件（供區塊元件復用）---- */
.ob-kv { display: flex; flex-direction: column; gap: 10px; }
.ob-kv-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; }
.ob-kv-key { color: var(--ob-muted); }
.ob-kv-val { color: var(--ob-text); font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; word-break: break-all; }
.ob-bar { height: 8px; border-radius: 6px; background: var(--ob-card-2); overflow: hidden; }
.ob-bar-fill { height: 100%; border-radius: 6px; transition: width .5s ease; }
.ob-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ob-mini-value { font-size: 20px; font-weight: 700; color: var(--ob-text); font-variant-numeric: tabular-nums; }
.ob-mini-label { font-size: 11px; color: var(--ob-muted); margin-bottom: 4px; }
.ob-footer { margin-top: 26px; text-align: center; font-size: 11px; color: var(--ob-muted); opacity: .75; }

/* ---- 多端適配 ---- */
@media (max-width: 1100px) {
  .ob-span-3, .ob-span-4 { grid-column: span 6; }
  .ob-span-8 { grid-column: span 12; }
}
@media (max-width: 720px) {
  .ob-shell { padding: 14px 14px 32px; }
  .ob-header { flex-direction: column; align-items: flex-start; }
  .ob-controls { width: 100%; flex-direction: column; align-items: flex-start; }
  .ob-tabs { width: 100%; overflow-x: auto; }
  .ob-tab { flex: 1; }
  .ob-grid > * { grid-column: span 12 !important; } /* 行動端單列卡片 */
}
@media (max-width: 480px) {
  .ob-metrics { grid-template-columns: 1fr; }
  .ob-grid-2 { grid-template-columns: 1fr; }
}
</style>

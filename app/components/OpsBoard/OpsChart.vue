<template>
  <div ref="wrap" class="chart-wrap" :style="{ minHeight: H + 'px' }">
    <svg
      v-if="hasData"
      class="chart-svg"
      width="100%"
      :height="H"
      :viewBox="`0 0 ${width} ${H}`"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      :aria-label="ariaLabel"
    >
      <!-- 網格與座標軸（折線 / 柱狀） -->
      <g v-if="showGrid && type !== 'donut'">
        <line
          v-for="(t, i) in yTicks" :key="'g' + i"
          :x1="pad.l" :x2="width - pad.r" :y1="t.y" :y2="t.y" class="grid-line"
        />
        <text
          v-for="(t, i) in yTicks" :key="'yt' + i"
          :x="pad.l - 6" :y="t.y + 3" class="axis-text" text-anchor="end"
        >{{ t.label }}</text>
      </g>

      <!-- 折線 -->
      <template v-if="type === 'line'">
        <path
          v-if="chart.series.length === 1"
          :d="areaPath(chart.series[0])"
          :fill="chart.series[0].color || palette[0]"
          opacity="0.12"
        />
        <path
          v-for="(s, i) in chart.series" :key="'l' + i"
          :d="linePath(s)" fill="none"
          :stroke="s.color || palette[i % palette.length]"
          stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
        />
      </template>

      <!-- 柱狀 -->
      <template v-else-if="type === 'bar'">
        <rect
          v-for="(b, i) in bars" :key="'b' + i"
          :x="b.x" :y="b.y" :width="b.w" :height="b.h" :fill="b.color" rx="2"
        >
          <title>{{ b.name }} · {{ b.label }}: {{ b.value }}</title>
        </rect>
      </template>

      <!-- 環形 -->
      <template v-else-if="type === 'donut'">
        <g :transform="`rotate(-90 ${donut.cx} ${donut.cy})`">
          <circle
            :cx="donut.cx" :cy="donut.cy" :r="donut.r" fill="none"
            stroke="#232d47" :stroke-width="donut.sw"
          />
          <circle
            v-for="(a, i) in arcs" :key="'d' + i"
            :cx="donut.cx" :cy="donut.cy" :r="donut.r" fill="none"
            :stroke="a.color" :stroke-width="donut.sw"
            :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset"
          >
            <title>{{ a.label }}: {{ formatCount(a.value) }} ({{ (a.frac * 100).toFixed(1) }}%)</title>
          </circle>
        </g>
        <text :x="donut.cx" :y="donut.cy - 2" text-anchor="middle" class="donut-total">
          {{ formatCount(total) }}
        </text>
        <text :x="donut.cx" :y="donut.cy + 16" text-anchor="middle" class="donut-label">
          {{ donutLabel }}
        </text>
      </template>

      <!-- X 軸標籤 -->
      <g v-if="showGrid && type !== 'donut'">
        <text
          v-for="(t, i) in xTicks" :key="'xt' + i"
          :x="t.x" :y="H - 6" class="axis-text" text-anchor="middle"
        >{{ t.label }}</text>
      </g>
    </svg>

    <div v-else class="ob-empty">{{ emptyText }}</div>

    <div v-if="hasData && showLegend && legendItems.length" class="chart-legend">
      <span v-for="(it, i) in legendItems" :key="'lg' + i" class="lg-item">
        <i class="lg-dot" :style="{ background: it.color }" />{{ it.label }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toChart, toNumber, formatCount, SERIES_COLORS } from './format.js'

const props = defineProps({
  type: { type: String, default: 'line' }, // line | bar | donut
  series: { type: [Array, Object], default: () => [] },
  labels: { type: Array, default: () => [] },
  height: { type: [Number, String], default: 220 },
  colors: { type: Array, default: () => [] },
  showLegend: { type: Boolean, default: true },
  showGrid: { type: Boolean, default: true },
  donutLabel: { type: String, default: '总计' },
  emptyText: { type: String, default: '数据暂不可用' },
  ariaLabel: { type: String, default: '数据趋势图' }
})

const H = computed(() => Math.max(120, toNumber(props.height, 220)))
const palette = computed(() => (props.colors.length ? props.colors : SERIES_COLORS))
const pad = { l: 46, r: 14, t: 14, b: 26 }

// 容器寬度量測：圖表隨卡片寬度自適應
const wrap = ref(null)
const width = ref(600)
let ro = null
let fallback = null
onMounted(() => {
  const el = wrap.value
  if (!el) return
  const measure = () => {
    const w = el.clientWidth
    if (w > 0) width.value = Math.round(w)
  }
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure)
    ro.observe(el)
  } else if (typeof window !== 'undefined') {
    fallback = measure
    window.addEventListener('resize', fallback)
  }
})
onUnmounted(() => {
  if (ro) ro.disconnect()
  if (fallback && typeof window !== 'undefined') window.removeEventListener('resize', fallback)
})

const plotW = computed(() => Math.max(20, width.value - pad.l - pad.r))
const plotH = computed(() => Math.max(20, H.value - pad.t - pad.b))

// 容錯正規化：支援 number[] / {name,data}[] / {t,requests,...}[] / {labels,series}
const chart = computed(() => {
  let raw = props.series
  let lbl = props.labels
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    lbl = raw.labels || lbl
    raw = raw.series || []
  }
  const c = toChart(Array.isArray(raw) ? raw : [])
  return {
    labels: Array.isArray(lbl) && lbl.length ? lbl.map(String) : c.labels,
    series: c.series.map((s, i) => ({
      ...s,
      color: s.color || palette.value[i % palette.value.length]
    }))
  }
})

const hasData = computed(
  () => chart.value.series.length > 0 && chart.value.series.some((s) => s.data.length > 0)
)

function niceMax(v) {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return m * p
}

const bounds = computed(() => {
  const all = chart.value.series.flatMap((s) => s.data).map((v) => toNumber(v, 0))
  return { min: 0, max: niceMax(Math.max(0, ...all)) }
})

const xOf = (i, n) => pad.l + ((i + 0.5) / Math.max(1, n)) * plotW.value
const yOf = (v) => {
  const { min, max } = bounds.value
  return pad.t + plotH.value - ((toNumber(v, 0) - min) / (max - min || 1)) * plotH.value
}

const yTicks = computed(() => {
  const { min, max } = bounds.value
  return [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: pad.t + plotH.value - f * plotH.value,
    label: formatCount(min + (max - min) * f)
  }))
})

const xTicks = computed(() => {
  const labels = chart.value.labels
  const n = labels.length
  if (!n) return []
  const step = Math.max(1, Math.ceil(n / 6))
  const out = []
  for (let i = 0; i < n; i += step) out.push({ label: labels[i], x: xOf(i, n) })
  return out
})

function linePath(s) {
  const n = s.data.length
  if (!n) return ''
  if (n === 1) {
    const x = xOf(0, 1)
    const y = yOf(s.data[0])
    return `M ${x} ${y} L ${x + 0.001} ${y}`
  }
  return s.data
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i, n).toFixed(1)} ${yOf(v).toFixed(1)}`)
    .join(' ')
}

function areaPath(s) {
  const n = s.data.length
  if (n < 2) return ''
  const base = yOf(0)
  return `${linePath(s)} L ${xOf(n - 1, n).toFixed(1)} ${base.toFixed(1)} L ${xOf(0, n).toFixed(1)} ${base.toFixed(1)} Z`
}

const bars = computed(() => {
  const c = chart.value
  const n = Math.max(1, c.labels.length || c.series[0]?.data.length || 1)
  const sc = Math.max(1, c.series.length)
  const group = plotW.value / n
  const bw = Math.max(2, (group * 0.68) / sc)
  const out = []
  c.series.forEach((s, si) => {
    s.data.forEach((v, i) => {
      const x = pad.l + i * group + group * 0.16 + si * bw
      const y = yOf(v)
      out.push({
        x, y, w: Math.max(1, bw - 1.5), h: Math.max(0, yOf(0) - y),
        color: s.color || palette.value[si % palette.value.length],
        value: v, name: s.name, label: c.labels[i] || String(i + 1)
      })
    })
  })
  return out
})

const donut = computed(() => {
  const r = Math.max(20, Math.min(width.value, H.value) / 2 - 14)
  return { cx: width.value / 2, cy: H.value / 2, r, sw: Math.max(10, r * 0.42) }
})

const donutSlices = computed(() => {
  const c = chart.value
  const sum = (arr) => arr.reduce((a, b) => a + toNumber(b, 0), 0)
  let out = []
  if (c.series.length > 1) {
    out = c.series.map((s, i) => ({
      label: s.name, value: sum(s.data),
      color: s.color || palette.value[i % palette.value.length]
    }))
  } else if (c.series.length === 1) {
    out = c.series[0].data.map((v, i) => ({
      label: c.labels[i] || String(i + 1), value: toNumber(v, 0),
      color: palette.value[i % palette.value.length]
    }))
  }
  return out.filter((x) => x.value > 0)
})

const total = computed(() => donutSlices.value.reduce((a, b) => a + b.value, 0))
const circumference = computed(() => 2 * Math.PI * donut.value.r)
const arcs = computed(() => {
  const c = circumference.value
  let offset = 0
  return donutSlices.value.map((x) => {
    const frac = total.value > 0 ? x.value / total.value : 0
    const len = frac * c
    const arc = {
      ...x, frac,
      dash: `${len.toFixed(2)} ${(c - len).toFixed(2)}`,
      offset: -offset
    }
    offset += len
    return arc
  })
})

const legendItems = computed(() => {
  if (props.type === 'donut') {
    return donutSlices.value.slice(0, 8).map((x) => ({
      label: `${x.label} ${total.value ? ((x.value / total.value) * 100).toFixed(0) : 0}%`,
      color: x.color
    }))
  }
  return chart.value.series.map((s, i) => ({
    label: s.name, color: s.color || palette.value[i % palette.value.length]
  }))
})
</script>

<style scoped>
.chart-wrap { width: 100%; overflow: hidden; }
.chart-svg { display: block; max-width: 100%; }
.grid-line { stroke: rgba(255, 255, 255, .07); stroke-width: 1; }
.axis-text { fill: var(--ob-muted); font-size: 10px; }
.donut-total { fill: var(--ob-text); font-size: 20px; font-weight: 700; }
.donut-label { fill: var(--ob-muted); font-size: 11px; }
.chart-legend {
  display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 8px;
  font-size: 11px; color: var(--ob-muted);
}
.lg-item { display: inline-flex; align-items: center; gap: 6px; }
.lg-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; flex-shrink: 0; }
</style>

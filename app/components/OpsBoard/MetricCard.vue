<template>
  <div class="ob-card metric" :class="'accent-' + accent">
    <div class="metric-head">
      <span class="metric-label">{{ label }}</span>
      <span v-if="estimated" class="est-tag" title="应用侧估算口径">估算</span>
    </div>

    <div class="metric-value-row">
      <span class="metric-value">{{ displayValue }}</span>
      <span v-if="unit" class="metric-unit">{{ unit }}</span>
    </div>

    <div class="metric-foot">
      <div class="metric-meta">
        <span v-if="deltaInfo" class="delta">
          {{ deltaInfo.dir === 'up' ? '▲' : '▼' }} {{ deltaInfo.text }}
        </span>
        <span v-else-if="hint" class="hint">{{ hint }}</span>
        <span v-if="unavailable" class="hint warn">数据暂不可用</span>
      </div>
      <!-- 手寫 SVG sparkline，不引圖表庫 -->
      <svg
        v-if="sparkPath"
        class="spark"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon :points="sparkArea" fill="currentColor" opacity="0.12" />
        <polyline
          :points="sparkPath"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatCount, formatDelta } from './format.js'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: '—' },
  unit: { type: String, default: '' },
  delta: { type: [Number, String, Object], default: null },
  spark: { type: Array, default: () => [] },
  hint: { type: String, default: '' },
  // 看板內部擴充（不影響契約要求的 props）
  accent: { type: String, default: 'blue' },
  estimated: { type: Boolean, default: false },
  unavailable: { type: Boolean, default: false }
})

const displayValue = computed(() =>
  typeof props.value === 'number' ? formatCount(props.value) : String(props.value)
)

const deltaInfo = computed(() => {
  const d = props.delta
  if (d === null || d === undefined || d === '') return null
  if (typeof d === 'object') return d
  return formatDelta(d)
})

const sparkPath = computed(() => {
  const arr = (props.spark || []).map((x) => Number(x) || 0)
  if (arr.length < 2) return ''
  const min = Math.min(...arr)
  const max = Math.max(...arr)
  const span = max - min || 1
  return arr
    .map((v, i) => {
      const x = (i / (arr.length - 1)) * 100
      const y = 30 - ((v - min) / span) * 26
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

const sparkArea = computed(() =>
  sparkPath.value ? `0,32 ${sparkPath.value} 100,32` : ''
)
</script>

<style scoped>
.metric {
  --ob-accent-color: #3b82f6;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
}
.metric.accent-blue { --ob-accent-color: #3b82f6; }
.metric.accent-red { --ob-accent-color: #f87171; }
.metric.accent-amber { --ob-accent-color: #fbbf24; }
.metric.accent-green { --ob-accent-color: #34d399; }
.metric.accent-cyan { --ob-accent-color: #22d3ee; }
.metric.accent-purple { --ob-accent-color: #a78bfa; }

.metric-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.metric-label { font-size: 13px; color: var(--ob-muted); font-weight: 500; }
.est-tag {
  font-size: 10px; color: var(--ob-amber); border: 1px solid rgba(251, 191, 36, .35);
  background: rgba(251, 191, 36, .08); padding: 1px 6px; border-radius: 6px; flex-shrink: 0;
}
.metric-value-row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.metric-value {
  font-size: 30px; font-weight: 700; line-height: 1.1; color: var(--ob-text);
  letter-spacing: -.5px; font-variant-numeric: tabular-nums; word-break: break-all;
}
.metric-unit { font-size: 13px; color: var(--ob-muted); }
.metric-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; margin-top: auto; }
.metric-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.delta { font-size: 12px; color: var(--ob-muted); font-variant-numeric: tabular-nums; }
.hint { font-size: 11px; color: var(--ob-muted); opacity: .85; }
.hint.warn { color: var(--ob-amber); opacity: 1; }
.spark { width: 88px; height: 32px; color: var(--ob-accent-color); flex-shrink: 0; }
@media (max-width: 520px) { .metric-value { font-size: 26px; } }
</style>

<template>
  <section class="ob-card online">
    <header class="ob-card-head">
      <h3 class="ob-card-title">实时访问人数</h3>
      <span class="live-tag"><i class="ob-dot" /> 实时</span>
    </header>

    <div v-if="!rt || (err && !rt)" class="ob-empty">数据暂不可用</div>
    <template v-else>
      <div class="online-main">
        <span class="online-num">{{ onlineText }}</span>
        <span class="online-unit">人在线</span>
      </div>

      <div class="online-peak">
        <div class="peak-head">
          <span class="peak-label">{{ rangeLabel }}峰值</span>
          <span class="peak-value">
            {{ peakInfo.text }}<em v-if="peakInfo.unit">{{ peakInfo.unit }}</em>
          </span>
        </div>
        <p class="peak-sub" :title="peakHint">{{ peakInfo.sub }}</p>
      </div>

      <div class="online-sub">
        <span>实时 QPS</span>
        <strong>{{ qpsText }}</strong>
      </div>
      <p class="online-hint">在线按近 5 分钟活跃 IP 去重 · 峰值按分钟采样</p>
      <span v-if="estimated" class="ob-est online-est">应用侧估算</span>
    </template>
  </section>
</template>

<script setup>
import { computed, inject } from 'vue'
import { describePeakOnline, formatCount, formatMomentShort } from './format.js'

const ctx = inject('opsBoardContext')
const rt = computed(() => ctx.data.realtime)
const err = computed(() => ctx.errors.realtime)
const estimated = ctx.estimated
const rangeLabel = ctx.rangeLabel

const onlineText = computed(() => (rt.value ? formatCount(rt.value.online) : '—'))
const qpsText = computed(() =>
  rt.value?.qpsRealtime != null ? formatCount(rt.value.qpsRealtime) : '—'
)

const peak = computed(() => rt.value?.peak || null)
const peakInfo = computed(() => describePeakOnline(peak.value))

const peakHint = computed(() => {
  const since = peak.value?.since
  const minutes = peak.value?.sampleMinutes ?? 1
  return typeof since === 'number'
    ? `每 ${minutes} 分钟记录一次在线人数；本看板自 ${formatMomentShort(since)} 起有采样数据`
    : '在线人数采样尚未产生数据，部署后约 1 分钟可见'
})
</script>

<style scoped>
.online { position: relative; overflow: hidden; }
.online::after {
  content: ''; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px;
  background: radial-gradient(circle, rgba(34, 211, 238, .12), transparent 70%); pointer-events: none;
}
.live-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ob-green); }
.online-main { display: flex; align-items: baseline; gap: 8px; margin: 6px 0 14px; }
.online-num {
  font-size: 48px; font-weight: 800; line-height: 1; letter-spacing: -1.5px;
  color: #fff; font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 24px rgba(34, 211, 238, .25);
}
.online-unit { font-size: 13px; color: var(--ob-muted); }

.online-peak { border-top: 1px solid var(--ob-border); padding: 12px 0 0; margin-bottom: 12px; }
.peak-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.peak-label { font-size: 12px; color: var(--ob-muted); }
.peak-value { font-size: 22px; font-weight: 700; color: #fbbf24; font-variant-numeric: tabular-nums; }
.peak-value em { font-size: 12px; font-style: normal; font-weight: 500; color: var(--ob-muted); margin-left: 3px; }
.peak-sub { margin: 4px 0 0; font-size: 11px; color: var(--ob-muted); opacity: .85; }

.online-sub {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--ob-muted);
  border-top: 1px solid var(--ob-border); padding-top: 12px;
}
.online-sub strong { color: var(--ob-cyan); font-size: 15px; font-variant-numeric: tabular-nums; }
.online-hint { margin: 10px 0 0; font-size: 11px; color: var(--ob-muted); opacity: .8; }
.online-est { position: absolute; right: 18px; bottom: 16px; }
@media (max-width: 480px) { .online-num { font-size: 40px; } }
</style>

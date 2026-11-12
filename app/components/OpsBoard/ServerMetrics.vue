<template>
  <section class="ob-card">
    <header class="ob-card-head">
      <h3 class="ob-card-title">服务器实时指标</h3>
      <span v-if="estimated" class="ob-est">应用侧估算</span>
    </header>

    <div v-if="!m || (err && !m)" class="ob-empty">数据暂不可用</div>
    <div v-else-if="!available" class="ob-empty">未安装采集器</div>

    <template v-else>
      <div class="ob-grid-2">
        <div class="sm-box">
          <div class="ob-mini-label">CPU 使用率</div>
          <div class="ob-mini-value">{{ cpuText }}</div>
          <div class="ob-bar"><div class="ob-bar-fill" :style="{ width: pct(cpuRaw) + '%', background: '#3b82f6' }" /></div>
        </div>
        <div class="sm-box">
          <div class="ob-mini-label">内存使用率</div>
          <div class="ob-mini-value">{{ memText }}</div>
          <div class="ob-bar"><div class="ob-bar-fill" :style="{ width: pct(memRaw) + '%', background: '#a78bfa' }" /></div>
        </div>
        <div class="sm-box">
          <div class="ob-mini-label">网络下行</div>
          <div class="ob-mini-value sm-rate">{{ rxText }}</div>
        </div>
        <div class="sm-box">
          <div class="ob-mini-label">网络上行</div>
          <div class="ob-mini-value sm-rate">{{ txText }}</div>
        </div>
      </div>

      <div class="sm-chart">
        <div class="ob-subtle sm-chart-title">资源时序</div>
        <OpsBoardOpsChart
          type="line"
          :series="chart.series"
          :labels="chart.labels"
          :height="120"
          :colors="['#3b82f6', '#a78bfa']"
          empty-text="暂无时序数据"
          aria-label="服务器资源时序图"
        />
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, inject } from 'vue'
import { asPercentValue, formatPercent, formatRate, toChart } from './format.js'

const ctx = inject('opsBoardContext')
const m = computed(() => ctx.data.serverMetrics)
const err = computed(() => ctx.errors.serverMetrics)
const estimated = ctx.estimated

// available 缺省视为已安装；仅显式 false 才降级（契约：不存在降级 available:false）
const available = computed(() => !!m.value && m.value?.available !== false)
const cpuRaw = computed(() => asPercentValue(m.value?.cpu) ?? 0)
const memRaw = computed(() => asPercentValue(m.value?.memory) ?? 0)
const cpuText = computed(() => formatPercent(m.value?.cpu))
const memText = computed(() => formatPercent(m.value?.memory))
const rxText = computed(() => formatRate(m.value?.netRx))
const txText = computed(() => formatRate(m.value?.netTx))
const pct = (v) => Math.min(100, Math.max(0, v))
const chart = computed(() => toChart(m.value?.series, { names: ['CPU', '内存'] }))
</script>

<style scoped>
.sm-box {
  background: var(--ob-card-2); border: 1px solid var(--ob-border);
  border-radius: 9px; padding: 12px 14px;
}
.sm-box .ob-bar { margin-top: 10px; }
.sm-rate { font-size: 17px; }
.sm-chart { margin-top: 16px; border-top: 1px solid var(--ob-border); padding-top: 12px; }
.sm-chart-title { margin-bottom: 4px; }
</style>

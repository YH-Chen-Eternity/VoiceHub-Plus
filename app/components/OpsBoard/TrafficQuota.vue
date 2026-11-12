<template>
  <section class="ob-card">
    <header class="ob-card-head">
      <h3 class="ob-card-title">腾讯云流量与资源包</h3>
      <span v-if="estimated" class="ob-est">应用侧估算</span>
    </header>

    <div v-if="!t || (err && !t)" class="ob-empty">数据暂不可用</div>

    <template v-else>
      <div class="ob-grid-2">
        <div class="tq-box">
          <div class="ob-mini-label">今日流量（应用侧计量）</div>
          <div class="ob-mini-value">{{ todayText }}</div>
        </div>
        <div class="tq-box">
          <div class="ob-mini-label">本月流量（应用侧计量）</div>
          <div class="ob-mini-value">{{ monthText }}</div>
        </div>
      </div>

      <div class="tq-official">
        <span class="ob-subtle">官方口径：</span>
        <span v-if="!officialAvailable" class="tq-off">未配置官方口径</span>
        <span v-else>今日 {{ officialToday }} · 本月 {{ officialMonth }}</span>
      </div>

      <div class="tq-quota">
        <div class="ob-kv-row">
          <span class="ob-kv-key">资源包 总量 / 已用 / 剩余</span>
          <span class="ob-kv-val">{{ quotaText }}</span>
        </div>
        <div class="ob-bar tq-bar">
          <div class="ob-bar-fill" :style="{ width: quotaPct + '%', background: quotaColor }" />
        </div>
        <div class="ob-subtle tq-quota-foot">
          {{ quotaSourceLabel }}已用 {{ quotaPct.toFixed(1) }}%
        </div>
        <div v-if="quotaResetText" class="ob-subtle tq-quota-foot">{{ quotaResetText }}</div>
      </div>

      <div class="tq-rank">
        <div class="ob-subtle tq-rank-title">按文件流量排名</div>
        <div v-if="!rank.length" class="ob-subtle tq-rank-empty">暂无计量数据</div>
        <ul v-else class="tq-rank-list">
          <li v-for="(it, i) in rank" :key="it.name + '-' + i" class="tq-rank-row">
            <div class="tq-rank-label">
              <span class="tq-rank-name" :title="it.name">{{ it.name }}</span>
              <span class="tq-rank-value">{{ formatBytes(it.value) }}</span>
            </div>
            <div class="ob-bar tq-rank-track">
              <div class="ob-bar-fill" :style="{ width: rankPct(it.value) + '%', background: '#22d3ee' }" />
            </div>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, inject } from 'vue'
import { formatBytes, toNumber, toTopItems } from './format.js'

const ctx = inject('opsBoardContext')
const t = computed(() => ctx.data.traffic)
const err = computed(() => ctx.errors.traffic)
const estimated = ctx.estimated

const metered = computed(() => t.value?.metered || {})
const official = computed(() => t.value?.official || {})
const quota = computed(() => t.value?.quota || {})

const todayText = computed(() => formatBytes(metered.value.today))
const monthText = computed(() => formatBytes(metered.value.month))
const officialAvailable = computed(() => official.value.available !== false)
const officialToday = computed(() => formatBytes(official.value.today))
const officialMonth = computed(() => formatBytes(official.value.month))

const quotaTotal = computed(() => toNumber(quota.value.total, 0))
const quotaUsed = computed(() => toNumber(quota.value.used, 0))
const quotaRemaining = computed(() => toNumber(quota.value.remaining, Math.max(0, quotaTotal.value - quotaUsed.value)))
const quotaPct = computed(() =>
  quotaTotal.value > 0 ? Math.min(100, Math.max(0, (quotaUsed.value / quotaTotal.value) * 100)) : 0
)
const quotaColor = computed(() => (quotaPct.value >= 90 ? '#f87171' : quotaPct.value >= 70 ? '#fbbf24' : '#34d399'))
const quotaText = computed(() =>
  quotaTotal.value > 0
    ? `${formatBytes(quotaTotal.value)} / ${formatBytes(quotaUsed.value)} / ${formatBytes(quotaRemaining.value)}`
    : '未配置资源包'
)
const quotaSourceLabel = computed(() =>
  quota.value.source === 'lighthouse' ? '腾讯云真实口径 · ' : ''
)
const quotaResetText = computed(() => {
  if (quota.value.source !== 'lighthouse' || !t.value?.lighthouse?.periodEnd) return ''
  const end = new Date(t.value.lighthouse.periodEnd)
  if (Number.isNaN(end.getTime())) return ''
  // 部署时区为东八区（无 DST），ceil 到整天数不会跨时区漂移
  const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000))
  return `计费周期 ${end.getMonth() + 1} 月 ${end.getDate()} 日重置（剩 ${days} 天）`
})

const rank = computed(() => toTopItems(metered.value.rank).slice(0, 5))
const rankMax = computed(() => Math.max(1, ...rank.value.map((r) => Math.abs(toNumber(r.value)))))
const rankPct = (v) => Math.max(2, (Math.abs(toNumber(v)) / rankMax.value) * 100)
</script>

<style scoped>
.tq-box { background: var(--ob-card-2); border: 1px solid var(--ob-border); border-radius: 9px; padding: 12px 14px; }
.tq-official { font-size: 12px; color: var(--ob-muted); margin: 14px 0; }
.tq-off { color: var(--ob-amber); }
.tq-quota { border-top: 1px solid var(--ob-border); padding-top: 12px; }
.tq-bar { margin-top: 10px; }
.tq-quota-foot { margin-top: 6px; }
.tq-rank { border-top: 1px solid var(--ob-border); margin-top: 14px; padding-top: 12px; }
.tq-rank-title { margin-bottom: 10px; }
.tq-rank-empty { padding: 8px 0; }
.tq-rank-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tq-rank-label { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11px; margin-bottom: 4px; }
.tq-rank-name { color: var(--ob-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.tq-rank-value { color: var(--ob-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
.tq-rank-track { height: 4px; }
</style>

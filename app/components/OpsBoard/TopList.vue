<template>
  <section class="ob-card top-card">
    <header class="ob-card-head">
      <h3 class="ob-card-title">{{ title }}</h3>
      <span v-if="estimated" class="est-tag" title="应用侧估算口径">估算</span>
    </header>

    <div v-if="!rows.length" class="ob-empty">{{ emptyText }}</div>

    <ul v-else class="top-list">
      <li v-for="(it, i) in rows" :key="it.name + '-' + i" class="top-row">
        <div class="top-label">
          <span class="top-rank" :class="{ 'top-rank-hot': i < 3 }">{{ i + 1 }}</span>
          <span class="top-name" :title="it.name">{{ it.name }}</span>
          <span class="top-value">{{ formatVal(it.value) }}</span>
        </div>
        <div class="top-track">
          <div class="top-fill" :style="{ width: pct(it.value) + '%', background: color }" />
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { toTopItems, formatCount, formatBytes, toNumber } from './format.js'

const props = defineProps({
  title: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  // 值口径：'' 走 formatCount，'bytes' 走 formatBytes
  unit: { type: String, default: '' },
  color: { type: String, default: '#3b82f6' },
  emptyText: { type: String, default: '暂无数据' },
  estimated: { type: Boolean, default: false },
  limit: { type: Number, default: 8 }
})

const rows = computed(() => toTopItems(props.items).slice(0, props.limit))
const maxVal = computed(() => Math.max(1, ...rows.value.map((r) => Math.abs(toNumber(r.value)))))
const pct = (v) => Math.max(2, (Math.abs(toNumber(v)) / maxVal.value) * 100)
const formatVal = (v) => (props.unit === 'bytes' ? formatBytes(v) : formatCount(v))
</script>

<style scoped>
.top-card { display: flex; flex-direction: column; }
.ob-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
.ob-card-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--ob-text); }
.est-tag {
  font-size: 10px; color: var(--ob-amber); border: 1px solid rgba(251, 191, 36, .35);
  background: rgba(251, 191, 36, .08); padding: 1px 6px; border-radius: 6px; flex-shrink: 0;
}
.top-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.top-label { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 12px; }
.top-rank {
  width: 18px; height: 18px; flex-shrink: 0; border-radius: 5px; display: inline-flex;
  align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
  background: rgba(255, 255, 255, .06); color: var(--ob-muted);
}
.top-rank-hot { background: rgba(59, 130, 246, .18); color: #7fb0ff; }
.top-name { flex: 1; min-width: 0; color: var(--ob-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.top-value { flex-shrink: 0; color: var(--ob-muted); font-variant-numeric: tabular-nums; }
.top-track { height: 5px; border-radius: 4px; background: var(--ob-card-2); overflow: hidden; }
.top-fill { height: 100%; border-radius: 4px; transition: width .5s ease; min-width: 2px; }
</style>

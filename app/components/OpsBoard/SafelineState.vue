<template>
  <section class="ob-card">
    <header class="ob-card-head">
      <h3 class="ob-card-title">雷池节点状态</h3>
      <span class="state-pill" :class="available ? 'ok' : 'off'">{{ available ? '在线' : '不可用' }}</span>
    </header>

    <div v-if="!s || (err && !s)" class="ob-empty">数据暂不可用</div>
    <div v-else-if="!available" class="ob-empty">雷池节点不可用</div>

    <div v-else class="ob-kv state-kv">
      <div class="ob-kv-row"><span class="ob-kv-key">版本</span><span class="ob-kv-val">{{ val(s?.version) }}</span></div>
      <div class="ob-kv-row"><span class="ob-kv-key">授权</span><span class="ob-kv-val">{{ val(s?.license) }}</span></div>
      <div class="ob-kv-row"><span class="ob-kv-key">站点数</span><span class="ob-kv-val">{{ val(s?.sites) }}</span></div>
      <div class="ob-kv-row"><span class="ob-kv-key">证书到期</span><span class="ob-kv-val">{{ certText }}</span></div>
      <div class="ob-kv-row"><span class="ob-kv-key">CC 阈值</span><span class="ob-kv-val">{{ val(s?.ccThreshold) }}</span></div>
      <div class="ob-kv-row"><span class="ob-kv-key">容量</span><span class="ob-kv-val">{{ val(s?.capacity) }}</span></div>
    </div>

    <!-- 純唯讀展示：看板不提供任何雷池配置或寫入控件 -->
    <p class="state-note">只读展示 · 雷池配置请在雷池控制台操作</p>
  </section>
</template>

<script setup>
import { computed, inject } from 'vue'
import { formatDate, pick } from './format.js'

const ctx = inject('opsBoardContext')
const s = computed(() => ctx.data.safeline)
const err = computed(() => ctx.errors.safeline)
const available = computed(() => !!s.value && s.value?.available !== false)

const certText = computed(() => {
  const v = s.value?.certExpiry
  if (!v) return '—'
  return formatDate(v)
})

// 欄位可能是物件（契約未定型），容錯成可讀文字
function val(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') {
    const x = pick(v, ['text', 'label', 'name', 'value', 'total', 'count', 'status', 'type'])
    if (x !== undefined) return String(x)
    try { return JSON.stringify(v).slice(0, 60) } catch (e) { return '—' }
  }
  return String(v)
}
</script>

<style scoped>
.state-pill { font-size: 10px; padding: 2px 9px; border-radius: 20px; }
.state-pill.ok { color: var(--ob-green); background: rgba(52, 211, 153, .1); border: 1px solid rgba(52, 211, 153, .28); }
.state-pill.off { color: var(--ob-muted); background: rgba(255, 255, 255, .05); border: 1px solid var(--ob-border); }
.state-kv { border-top: 1px solid var(--ob-border); padding-top: 12px; }
.state-note { margin: auto 0 0; padding-top: 12px; font-size: 11px; color: var(--ob-muted); opacity: .75; }
</style>

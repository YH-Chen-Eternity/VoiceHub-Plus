<template>
  <section class="ob-card">
    <header class="ob-card-head">
      <h3 class="ob-card-title">日志清理</h3>
      <span class="ob-subtle">写操作需 SUPER_ADMIN</span>
    </header>

    <div class="lc-form">
      <label class="lc-field">
        <span>删除 N 天前日志</span>
        <input v-model.number="days" type="number" min="1" max="3650" class="lc-input" aria-label="保留天数" />
      </label>
      <button class="ob-btn" :disabled="busy || !validDays" @click="preview">预览影响</button>
    </div>

    <div v-if="result" class="lc-result" :class="{ 'lc-result-real': !result.dryRun }">
      <div class="lc-result-title">{{ result.dryRun ? '预览结果（未删除）' : '删除完成' }}</div>
      <div v-if="result.rows.length" class="ob-kv">
        <div v-for="(r, i) in result.rows" :key="i" class="ob-kv-row">
          <span class="ob-kv-key">{{ r.label }}</span>
          <span class="ob-kv-val">{{ r.value }}</span>
        </div>
      </div>
      <p v-else class="lc-note">未返回影响行数明细</p>
      <p v-if="result.note" class="lc-note">{{ result.note }}</p>
    </div>

    <div v-if="error" class="lc-error">{{ error }}</div>

    <div class="lc-actions">
      <template v-if="confirmStep">
        <span class="lc-confirm-text">确认删除 {{ days }} 天前的日志？此操作不可撤销。</span>
        <button class="ob-btn lc-danger" :disabled="busy" @click="doDelete">确认删除</button>
        <button class="ob-btn" :disabled="busy" @click="confirmStep = false">取消</button>
      </template>
      <button v-else class="ob-btn lc-danger" :disabled="busy || !validDays" @click="confirmStep = true">删除日志</button>
    </div>

    <p class="lc-hint">预览（dryRun）不会删除任何数据；实删需二次确认并显示影响行数。</p>
  </section>
</template>

<script setup>
import { computed, inject, ref, watch } from 'vue'
import { formatInt, pick, toNumber } from './format.js'

const ctx = inject('opsBoardContext')
const days = ref(30)
const busy = ref(false)
const error = ref('')
const result = ref(null)
const confirmStep = ref(false)

// 以 settings(GET) 的 logRetentionDays 作为默认值
watch(
  () => ctx.data.settings?.logRetentionDays,
  (v) => {
    const n = toNumber(v, 0)
    if (n > 0) days.value = n
  },
  { immediate: true }
)

watch(days, () => { confirmStep.value = false })
const validDays = computed(
  () => Number.isFinite(days.value) && days.value >= 1 && days.value <= 3650
)

const LABELS = {
  attackLog: '攻击日志', loginAttempt: '登录尝试', adminAuditLog: '管理审计日志',
  safeline: '雷池攻击日志', deleted: '已删除', affected: '影响行数',
  rows: '影响行数', count: '影响行数', total: '合计'
}

// 回傳結構契約未定義，做容錯解析（見 CONTRACT-QUESTIONS-H.md）
function parseResult(d, dryRun) {
  const data = d && typeof d === 'object' ? d : {}
  const rows = []
  const push = (k, v) => {
    if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))) {
      rows.push({ label: LABELS[k] || k, value: formatInt(v) + ' 行' })
    }
  }
  for (const k of Object.keys(LABELS)) {
    const v = pick(data, [k])
    if (v !== undefined) push(k, v)
  }
  if (!rows.length) {
    const nested = pick(data, ['counts', 'affectedRows', 'details', 'breakdown', 'data']) || data
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const [k, v] of Object.entries(nested)) push(k, v)
    }
  }
  return {
    dryRun,
    rows,
    note: String(pick(data, ['note', 'message', 'safelineNote', 'hint', 'description']) || '')
  }
}

async function call(dryRun) {
  const r = await ctx.post('/api/ops-board/logs/cleanup', { days: days.value, dryRun })
  if (!r.ok) throw new Error(r.message || '操作失败')
  return r.data
}

async function preview() {
  busy.value = true
  error.value = ''
  result.value = null
  try {
    result.value = parseResult(await call(true), true)
  } catch (e) {
    error.value = e.message || '预览失败'
  } finally {
    busy.value = false
  }
}

async function doDelete() {
  busy.value = true
  error.value = ''
  try {
    result.value = parseResult(await call(false), false)
    confirmStep.value = false
    await ctx.refresh({ silent: true }) // 删除后即时重刷看板
  } catch (e) {
    error.value = e.message || '删除失败'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.lc-form { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.lc-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--ob-muted); }
.lc-input {
  width: 110px; background: var(--ob-card-2); color: var(--ob-text);
  border: 1px solid var(--ob-border); border-radius: 8px; padding: 6px 10px; font-size: 13px;
}
.lc-input:focus { outline: none; border-color: #3b82f6; }
.lc-result {
  margin-top: 14px; background: var(--ob-card-2); border: 1px solid var(--ob-border);
  border-radius: 9px; padding: 12px 14px;
}
.lc-result-real { border-color: rgba(248, 113, 113, .35); }
.lc-result-title { font-size: 12px; font-weight: 600; color: var(--ob-cyan); margin-bottom: 10px; }
.lc-result-real .lc-result-title { color: var(--ob-green); }
.lc-note { margin: 8px 0 0; font-size: 11px; color: var(--ob-muted); }
.lc-error {
  margin-top: 12px; font-size: 12px; color: var(--ob-red);
  background: rgba(248, 113, 113, .08); border: 1px solid rgba(248, 113, 113, .25);
  border-radius: 8px; padding: 8px 12px;
}
.lc-actions {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 14px; border-top: 1px solid var(--ob-border); padding-top: 14px;
}
.lc-danger { color: #ffb4b4; border-color: rgba(248, 113, 113, .35); }
.lc-danger:hover { border-color: var(--ob-red); }
.lc-confirm-text { font-size: 12px; color: var(--ob-amber); flex: 1; min-width: 180px; }
.lc-hint { margin: 12px 0 0; font-size: 11px; color: var(--ob-muted); opacity: .8; }
</style>

<template>
  <section class="ob-card">
    <header class="ob-card-head">
      <h3 class="ob-card-title">封禁名单</h3>
      <div class="ban-head-right">
        <span v-if="estimated" class="ob-est">应用侧估算</span>
        <span class="ob-badge ban-count">{{ rows.length }}</span>
      </div>
    </header>

    <div v-if="err && !a" class="ob-empty">数据暂不可用</div>
    <div v-else-if="!rows.length" class="ob-empty">暂无封禁记录</div>

    <ul v-else class="ban-list">
      <li v-for="(b, i) in rows" :key="b.ip + '-' + i" class="ban-row">
        <div class="ban-top">
          <span class="ban-ip">{{ b.ip }}</span>
          <span class="ban-time">{{ b.time }}</span>
        </div>
        <div class="ban-bottom">
          <span class="ban-reason" :title="b.reason">{{ b.reason }}</span>
          <span v-if="b.expire" class="ban-expire">{{ b.expire }}</span>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { computed, inject } from 'vue'
import { formatDate, pick } from './format.js'

const ctx = inject('opsBoardContext')
const a = computed(() => ctx.data.attacks)
const err = computed(() => ctx.errors.attacks)
const estimated = ctx.estimated

const rows = computed(() => {
  const list = a.value?.bans
  if (!Array.isArray(list)) return []
  return list.slice(0, 8).map((raw) => {
    if (raw === null || raw === undefined) return { ip: '—', reason: '—', time: '—', expire: '' }
    if (typeof raw !== 'object') return { ip: String(raw), reason: '—', time: '—', expire: '' }
    const expireRaw = pick(raw, ['expiresAt', 'expireAt', 'expire', 'until', 'expireTime'])
    return {
      ip: String(pick(raw, ['ip', 'address', 'addr', 'clientIp', 'value', 'key']) ?? '—'),
      reason: String(pick(raw, ['reason', 'rule', 'type', 'note', 'description', 'cause']) ?? '—'),
      time: formatDate(pick(raw, ['createdAt', 'bannedAt', 'time', 'ts', 'at', 'date'])),
      expire: expireRaw
        ? '至 ' + formatDate(expireRaw)
        : raw.permanent || raw.forever
          ? '永久'
          : ''
    }
  })
})
</script>

<style scoped>
.ban-head-right { display: flex; align-items: center; gap: 8px; }
.ban-count {
  background: rgba(248, 113, 113, .12); color: var(--ob-red);
  border: 1px solid rgba(248, 113, 113, .28); padding: 1px 9px;
}
.ban-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.ban-row { background: var(--ob-card-2); border: 1px solid var(--ob-border); border-radius: 8px; padding: 9px 11px; }
.ban-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ban-ip { font-size: 13px; font-weight: 600; color: #ffb4b4; font-variant-numeric: tabular-nums; }
.ban-time { font-size: 10px; color: var(--ob-muted); flex-shrink: 0; }
.ban-bottom { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 5px; }
.ban-reason { font-size: 11px; color: var(--ob-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ban-expire { font-size: 10px; color: var(--ob-amber); flex-shrink: 0; }
</style>

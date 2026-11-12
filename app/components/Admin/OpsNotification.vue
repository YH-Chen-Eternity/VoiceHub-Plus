/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

<template>
  <div class="max-w-[1400px] mx-auto space-y-6 pb-20 px-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
    <!-- 头部 -->
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-1">
        <h2 class="text-2xl font-black text-text-primary tracking-tight">{{ L('title') }}</h2>
        <p class="text-xs text-text-tertiary font-medium">{{ L('desc') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[11px] font-semibold text-text-disabled">
          {{ isSuperAdmin ? L('superAdminHint') : L('readOnlyHint') }}
        </span>
        <button
          class="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold bg-bg-primary-40 border border-border-secondary text-text-tertiary hover:text-text-primary hover:border-border-tertiary transition-all disabled:opacity-50"
          :disabled="loading"
          @click="load"
        >
          <RefreshCw :size="14" :class="loading ? 'animate-spin' : ''" />
          {{ L('refresh') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-16 text-xs text-text-tertiary">
      <RefreshCw :size="16" class="animate-spin" /> {{ L('loading') }}
    </div>

    <div
      v-else-if="loadError"
      class="flex flex-col items-center gap-3 rounded-2xl border border-error-20 bg-error-10 py-12 text-xs text-error"
    >
      <div class="flex items-center gap-2 font-bold"><AlertCircle :size="16" /> {{ loadError }}</div>
      <button
        type="button"
        class="rounded-lg border border-error-30 px-3 py-1.5 font-bold hover:bg-error-15"
        @click="load"
      >
        {{ L('retry') }}
      </button>
    </div>

    <template v-else>
      <!-- SMTP 通道状态 -->
      <section
        class="rounded-2xl border p-5"
        :class="smtpConfigured ? 'border-success-20 bg-success-10' : 'border-warning-20 bg-warning-10'"
      >
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div class="flex items-start gap-3 min-w-0">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              :class="smtpConfigured ? 'bg-success-10 text-success' : 'bg-warning-10 text-warning'"
            >
              <CheckCircle2 v-if="smtpConfigured" :size="18" />
              <AlertTriangle v-else :size="18" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-black" :class="smtpConfigured ? 'text-success' : 'text-warning'">
                {{ smtpConfigured ? L('smtpReady') : L('smtpNotReady') }}
              </h3>
              <p class="mt-1 text-[11px] leading-relaxed" :class="smtpConfigured ? 'text-success' : 'text-warning'">
                {{ smtpConfigured ? L('smtpReadyDesc') : L('smtpNotReadyDesc') }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition-all"
            :class="smtpConfigured
              ? 'border-border-secondary bg-bg-secondary-30 text-text-secondary hover:text-text-primary hover:border-border-tertiary'
              : 'border-warning-30 bg-bg-secondary-30 text-warning hover:bg-warning-10'"
            @click="goSmtp"
          >
            <Server :size="14" /> {{ L('goSmtp') }} <ArrowUpRight :size="13" />
          </button>
        </div>
      </section>

      <!-- 发件人（只读） -->
      <section class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4">
        <div class="flex items-center gap-2">
          <Send :size="16" class="text-primary" />
          <h3 class="text-sm font-black text-text-primary">{{ L('senderTitle') }}</h3>
        </div>
        <div class="space-y-1.5">
          <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ L('senderTitle') }}</label>
          <input
            :value="smtpFrom || L('senderEmpty')"
            type="text"
            readonly
            class="w-full rounded-xl border border-border-secondary bg-bg-primary-30 px-3 py-2.5 text-xs text-text-primary outline-none cursor-default"
          >
          <p class="px-1 text-[10px] leading-relaxed text-text-tertiary">{{ L('senderDesc') }}</p>
        </div>
      </section>

      <!-- 收件人编辑 -->
      <section class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-10 text-primary">
              <Users :size="16" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-text-primary">{{ L('recipientsTitle') }}</h3>
              <p class="mt-1 text-[11px] leading-relaxed text-text-tertiary">{{ L('recipientsDesc') }}</p>
            </div>
          </div>
          <span class="rounded-full bg-bg-tertiary px-3 py-1 text-[11px] font-bold text-text-tertiary">
            {{ L('validLabel') }} {{ parsed.valid.length }}
          </span>
        </div>

        <div class="space-y-1.5">
          <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ L('recipientsTitle') }}</label>
          <textarea
            v-model="rawRecipients"
            rows="5"
            :placeholder="L('recipientsPlaceholder')"
            :disabled="!isSuperAdmin"
            class="w-full min-h-[120px] rounded-xl border border-border-secondary bg-bg-primary-30 px-3 py-2.5 text-xs leading-relaxed text-text-primary outline-none focus:border-primary disabled:opacity-50"
          />
          <p class="px-1 text-[10px] text-text-tertiary">{{ L('recipientsHint') }}</p>
        </div>

        <!-- 解析结果 -->
        <div v-if="parsed.valid.length" class="flex flex-wrap gap-2">
          <span
            v-for="email in parsed.valid"
            :key="email"
            class="inline-flex items-center gap-1.5 rounded-lg border border-success-20 bg-success-10 px-2.5 py-1 text-[11px] font-bold text-success break-all"
          >
            <Mail :size="12" /> {{ email }}
          </span>
        </div>
        <p
          v-if="parsed.invalid.length"
          class="flex items-start gap-2 rounded-xl border border-error-20 bg-error-10 p-3 text-[11px] font-bold text-error"
        >
          <AlertCircle :size="14" class="shrink-0 mt-0.5" />
          <span>{{ L('invalidLabel') }}：{{ parsed.invalid.join('、') }}</span>
        </p>
        <p v-if="parsed.duplicates" class="flex items-center gap-2 px-1 text-[10px] text-text-tertiary">
          <Info :size="12" /> {{ L('duplicatesLabel') }} {{ parsed.duplicates }}
        </p>
        <p v-if="!rawRecipients.trim()" class="flex items-center gap-2 px-1 text-[10px] text-text-tertiary">
          <Info :size="12" /> {{ L('emptyHint') }}
        </p>
      </section>

      <!-- 触发方式说明 -->
      <section class="rounded-2xl border border-border-secondary bg-bg-primary-30 p-5">
        <div class="flex items-center gap-2">
          <Info :size="16" class="text-primary" />
          <h3 class="text-sm font-black text-text-primary">{{ L('tatTitle') }}</h3>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-text-tertiary">{{ L('tatDesc') }}</p>
      </section>

      <!-- 保存后引导 -->
      <div
        v-if="savedHint"
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-20 bg-primary-10 p-4 text-xs font-bold text-primary"
      >
        <span class="flex items-start gap-2 min-w-0">
          <Info :size="15" class="shrink-0 mt-0.5" /> {{ L('savedHint') }}
        </span>
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-primary-30 bg-bg-secondary-30 px-3 py-2 text-[11px] font-bold hover:bg-primary-10"
          @click="goSmtp"
        >
          {{ L('goSmtp') }} <ArrowUpRight :size="13" />
        </button>
      </div>

      <!-- 底部操作栏 -->
      <div class="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-border-secondary bg-bg-secondary-40 p-3">
        <span v-if="dirty" class="mr-auto flex items-center gap-2 px-2 text-[11px] font-bold text-warning">
          <AlertCircle :size="14" /> {{ L('unsaved') }}
        </span>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-secondary-30 px-4 py-2.5 text-xs font-bold text-text-secondary transition-all hover:bg-bg-secondary-50 disabled:opacity-50 disabled:cursor-not-allowed"
          :title="!smtpConfigured || parsed.valid.length === 0 ? L('testDisabledHint') : ''"
          :disabled="!isSuperAdmin || !smtpConfigured || testing || saving || parsed.invalid.length > 0 || parsed.valid.length === 0"
          @click="sendTest"
        >
          <Send :size="14" :class="{ 'animate-pulse': testing }" />
          {{ testing ? L('sendingTest') : L('sendTest') }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-[var(--primary-glow-20)] transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isSuperAdmin || saving || testing || parsed.invalid.length > 0"
          @click="save"
        >
          <Save :size="14" :class="{ 'animate-pulse': saving }" />
          {{ saving ? L('saving') : L('save') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, ref } from 'vue'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Info,
  Mail,
  RefreshCw,
  Save,
  Send,
  Server,
  Users
} from '@lucide/vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'
import { usePermissions } from '~/composables/usePermissions'

defineOptions({ name: 'AdminOpsNotification' })

// 跳转到 SMTP 设置页：由 dashboard.vue 的 handleNavigate(tab) 接住。
const emit = defineEmits(['navigate'])
const goSmtp = () => emit('navigate', 'smtp-config')

const { showToast } = useToast()
const { isSuperAdmin } = usePermissions()
const { admin } = useLocale()
const t = computed(() => admin.value?.opsNotification || {})

// 词典键 admin.opsNotification.* 由主 agent 统一加入；此处为简中兜底。
const FALLBACK = {
  title: '运维通知',
  desc: '配置运维告警邮件的收件人。发件通道沿用站内 SMTP 设置。',
  superAdminHint: '超级管理员可修改配置',
  readOnlyHint: '只读：仅超级管理员可修改',
  refresh: '刷新',
  loading: '正在加载配置...',
  loadFailed: '配置加载失败',
  retry: '重试',
  smtpReady: '站内 SMTP 已配置',
  smtpReadyDesc: '发信通道可用，运维告警邮件将经站内 SMTP 发出。',
  smtpNotReady: '站内 SMTP 未配置',
  smtpNotReadyDesc: '运维告警邮件当前无法发出，请先完成发信配置。',
  goSmtp: '前往 SMTP 设置',
  senderTitle: '当前发件人',
  senderDesc: '发件人来自站内 SMTP 设置（smtpFromEmail / smtpFromName），此处只读，不提供修改。',
  senderEmpty: '尚未设置发件人',
  recipientsTitle: '告警收件人',
  recipientsDesc: '可填写多个邮箱，使用逗号、分号、空格或换行分隔。',
  recipientsPlaceholder: 'ops@example.com, admin@example.com',
  recipientsHint: '支持逗号 / 分号 / 空格 / 换行分隔，提交时自动去重并校验格式。',
  validLabel: '有效邮箱',
  invalidLabel: '以下邮箱格式有误，请修正后再保存',
  duplicatesLabel: '已自动去重',
  emptyHint: '留空将回落到环境变量中配置的默认收件人。',
  tatTitle: '触发方式',
  tatDesc: '运维告警由腾讯云自动化助手（TAT，远程 SHELL + Cron 定时调度）触发；邮件由 voicehub-mailer 调用应用内部接口，交由站内 SMTP 发出。',
  savedHint: '收件人已保存。请前往「SMTP 设置」页确认发信通道可用。',
  unsaved: '有未保存的更改',
  save: '保存配置',
  saving: '保存中...',
  saved: '收件人已保存',
  saveFailed: '保存失败',
  saveVerifyMismatch: '已保存，但服务端回读值与提交值不一致，已按回读值刷新',
  sendTest: '发送测试邮件',
  sendingTest: '发送中...',
  testSent: (n) => `测试邮件已发送给 ${n} 位收件人`,
  testFailed: '测试邮件发送失败，请检查站内 SMTP 与收件人配置',
  testPartial: (s, f) => `测试邮件部分失败：成功 ${s} 位，失败 ${f} 位`,
  testDisabledHint: '需先配置站内 SMTP 且填写有效收件人'
}
const L = (key) => {
  const value = t.value?.[key]
  return value === undefined || value === null || value === '' ? (FALLBACK[key] || key) : value
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const parseRecipients = (text) => {
  const parts = String(text || '').split(/[\s,;，；、\n]+/).map(item => item.trim()).filter(Boolean)
  const seen = new Set()
  const valid = []
  const invalid = []
  for (const item of parts) {
    if (!EMAIL_RE.test(item)) {
      invalid.push(item)
      continue
    }
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    valid.push(item)
  }
  return { valid, invalid, duplicates: parts.length - valid.length - invalid.length }
}

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const loadError = ref('')
const savedHint = ref(false)
const smtpConfigured = ref(false)
const smtpFrom = ref('')
const rawRecipients = ref('')
const baseline = ref('[]')

const parsed = computed(() => parseRecipients(rawRecipients.value))
const dirty = computed(() => JSON.stringify(parsed.value.valid) !== baseline.value)

const apply = (data) => {
  smtpConfigured.value = !!data?.smtpConfigured
  smtpFrom.value = typeof data?.smtpFrom === 'string' ? data.smtpFrom : ''
  const list = Array.isArray(data?.recipients)
    ? data.recipients.filter(item => typeof item === 'string')
    : []
  rawRecipients.value = list.join('\n')
  baseline.value = JSON.stringify(parseRecipients(rawRecipients.value).valid)
}

const errMsg = (error, key) => error?.data?.message || L(key)

// no-store 数据：每次进入页面重新拉取，失败在组件内降级显示，不抛到全局
let lastLoadAt = 0
const load = async () => {
  const now = Date.now()
  if (now - lastLoadAt < 800) return
  lastLoadAt = now
  loading.value = true
  loadError.value = ''
  savedHint.value = false
  try {
    const data = await $fetch('/api/admin/ops-notification')
    apply(data)
  } catch (error) {
    loadError.value = errMsg(error, 'loadFailed')
  } finally {
    loading.value = false
  }
}

// 用当前表单里「尚未保存」的收件人试发，方便先验证再保存
const sendTest = async () => {
  if (!isSuperAdmin.value || testing.value || saving.value) return
  const recipients = parsed.value.valid
  if (!smtpConfigured.value || parsed.value.invalid.length || recipients.length === 0) return
  testing.value = true
  try {
    const result = await $fetch('/api/admin/ops-notification/test', {
      method: 'POST',
      body: { recipients }
    })
    const sent = Number(result?.sent || 0)
    const failed = Number(result?.failed || 0)
    if (failed > 0) {
      const msg = typeof L('testPartial') === 'function' ? L('testPartial')(sent, failed) : L('testPartial')
      showToast(msg, 'warning')
    } else {
      const msg = typeof L('testSent') === 'function' ? L('testSent')(sent) : L('testSent')
      showToast(msg, 'success')
    }
  } catch (error) {
    showToast(errMsg(error, 'testFailed'), 'error')
  } finally {
    testing.value = false
  }
}

const save = async () => {
  if (!isSuperAdmin.value || saving.value || testing.value || parsed.value.invalid.length) return
  saving.value = true
  const recipients = parsed.value.valid
  try {
    await $fetch('/api/admin/ops-notification', {
      method: 'PUT',
      body: { recipients }
    })
    // 回读校验
    const verified = await $fetch('/api/admin/ops-notification')
    apply(verified)
    savedHint.value = true
    if (JSON.stringify(parseRecipients(rawRecipients.value).valid) !== JSON.stringify(recipients)) {
      showToast(L('saveVerifyMismatch'), 'warning')
    } else {
      showToast(L('saved'), 'success')
    }
  } catch (error) {
    showToast(errMsg(error, 'saveFailed'), 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
onActivated(load)
</script>

<style scoped></style>

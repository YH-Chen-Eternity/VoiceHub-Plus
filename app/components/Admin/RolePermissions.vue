/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 角色权限配置页（仅超级管理员）：为 ADMIN / SONG_ADMIN / BROADCASTER / REVIEWER
 * 勾选可访问的后台页面；数据库与角色权限配置页为超管专属，不参与配置。
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
      <button
        class="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold bg-bg-primary-40 border border-border-secondary text-text-tertiary hover:text-text-primary hover:border-border-tertiary transition-all disabled:opacity-50"
        :disabled="loading"
        @click="load"
      >
        <AppSpinner v-if="loading" :size="14" />
        <RefreshCw v-else :size="14" />
        {{ L('refresh') }}
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-16 text-xs text-text-tertiary">
      <AppSpinner :size="16" /> {{ L('loading') }}
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
      <!-- 超管专属说明 -->
      <section class="rounded-2xl border border-primary-20 bg-primary-10 p-4 text-[11px] leading-relaxed text-text-secondary">
        <p class="flex items-start gap-2">
          <ShieldCheck :size="15" class="mt-0.5 shrink-0 text-primary" />
          <span>{{ L('scopeHint') }}</span>
        </p>
      </section>

      <!-- 各角色配置 -->
      <section
        v-for="role in CONFIGURABLE_ROLES"
        :key="role"
        class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <component :is="ROLE_ICONS[role]" :size="16" class="text-primary" />
            <h3 class="text-sm font-black text-text-primary">{{ roleLabel(role) }}</h3>
            <span
              v-if="isDefault(role)"
              class="rounded-full bg-bg-tertiary px-2.5 py-0.5 text-[10px] font-bold text-text-tertiary"
            >
              {{ L('defaultTag') }}
            </span>
            <span v-else class="rounded-full bg-primary-10 px-2.5 py-0.5 text-[10px] font-bold text-primary">
              {{ L('customTag') }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-bold text-text-tertiary">
              {{ L('selectedLabel') }} {{ drafts[role]?.length ?? 0 }} / {{ CONFIGURABLE_PAGE_IDS.length }}
            </span>
            <button
              type="button"
              class="rounded-lg border border-border-secondary bg-bg-secondary-30 px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-bg-secondary-50 disabled:opacity-50"
              :disabled="!isSuperAdmin || saving"
              @click="resetRole(role)"
            >
              {{ L('resetRole') }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
          <label
            v-for="pid in CONFIGURABLE_PAGE_IDS"
            :key="pid"
            class="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold transition-all"
            :class="drafts[role]?.includes(pid)
              ? 'border-primary-30 bg-primary-10 text-text-primary'
              : 'border-border-secondary bg-bg-primary-30 text-text-tertiary hover:border-border-tertiary'"
          >
            <input
              type="checkbox"
              class="accent-[var(--primary)]"
              :checked="drafts[role]?.includes(pid)"
              :disabled="!isSuperAdmin"
              @change="togglePage(role, pid)"
            >
            {{ pageLabel(pid) }}
          </label>
        </div>
      </section>

      <!-- 底部操作栏 -->
      <div class="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-border-secondary bg-bg-secondary-40 p-3">
        <span v-if="dirty" class="mr-auto flex items-center gap-2 px-2 text-[11px] font-bold text-warning">
          <AlertCircle :size="14" /> {{ L('unsaved') }}
        </span>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-[var(--primary-glow-20)] transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isSuperAdmin || saving || !dirty"
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
import { computed, onActivated, onMounted, reactive, ref } from 'vue'
import {
  AlertCircle,
  ClipboardList,
  Eye,
  ListMusic,
  RefreshCw,
  Save,
  ShieldCheck,
  Users
} from '@lucide/vue'
import { useLocale } from '~/utils/locale'
import AppSpinner from '~/components/UI/Common/AppSpinner.vue'
import { useToast } from '~/composables/useToast'
import { usePermissions } from '~/composables/usePermissions'
import {
  CONFIGURABLE_PAGE_IDS,
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_PAGES
} from '~~/types/rolePages'

defineOptions({ name: 'AdminRolePermissions' })

const ROLE_ICONS = { ADMIN: ShieldCheck, SONG_ADMIN: ListMusic, BROADCASTER: Eye, REVIEWER: ClipboardList }
// 角色中文名展示兜底（主文案走词典）
const ROLE_LABELS = { ADMIN: '管理员', SONG_ADMIN: '歌曲管理员', BROADCASTER: '放歌员', REVIEWER: '审帖员' }
// 页面 id → 词典 admin.menu 键
const PAGE_MENU_KEYS = {
  overview: 'overview', schedule: 'schedule', print: 'print', songs: 'songs', users: 'users',
  'grade-class': 'gradeClass', notifications: 'notifications', 'smtp-config': 'smtpConfig',
  playtimes: 'playtimes', 'request-times': 'requestTimes', semesters: 'semesters',
  blacklist: 'blacklist', 'site-config': 'siteConfig', 'api-keys': 'apiKeys',
  'data-analysis': 'dataAnalysis', 'card-codes': 'cardCodes', 'music-source': 'musicSource',
  'review-notes': 'reviewNotes', 'review-users': 'reviewUsers', announcement: 'announcement',
  'system-board': 'systemBoard', 'attack-logs': 'attackLogs', 'edge-protection': 'edgeProtection',
  'ops-notification': 'opsNotification', 'ops-board': 'opsBoard', 'community-review': 'communityReview',
  'community-comment-review': 'communityCommentReview', 'community-archive': 'communityArchive',
  'community-boards': 'communityBoards', 'community-titles': 'communityTitles',
  'community-users': 'communityUsers', 'community-settings': 'communitySettings',
  'community-reports': 'communityReports', 'community-overview': 'communityOverview'
}

const { showToast } = useToast()
const { isSuperAdmin } = usePermissions()
const { admin } = useLocale()
const t = computed(() => admin.value?.rolePermissions || {})

const L = (key) => {
  const value = t.value?.[key]
  return value === undefined || value === null || value === '' ? key : value
}
const roleLabel = (role) => admin.value?.sidebar?.roles?.[role] || ROLE_LABELS[role] || role
const pageLabel = (pid) => {
  const menuKey = PAGE_MENU_KEYS[pid]
  return (menuKey && admin.value?.sidebar?.menu?.[menuKey]) || pid
}

const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
// 草稿：每个角色的勾选页面数组（null = 使用内置默认，与后端存储一致）
const drafts = reactive({})
const stored = ref({}) // 后端返回的 rolePages（区分默认与自定义）

const isDefault = (role) => !(role in stored.value)
const sameList = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())

const dirty = computed(() => {
  return CONFIGURABLE_ROLES.some((role) => {
    const base = isDefault(role) ? DEFAULT_ROLE_PAGES[role] : stored.value[role]
    return !sameList(base, drafts[role])
  })
})

const errMsg = (error, key) => error?.data?.message || L(key)

const applyDrafts = () => {
  for (const role of CONFIGURABLE_ROLES) {
    const base = isDefault(role) ? DEFAULT_ROLE_PAGES[role] : stored.value[role]
    drafts[role] = [...base]
  }
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const data = await $fetch('/api/admin/role-pages')
    stored.value = data?.rolePages && typeof data.rolePages === 'object' ? data.rolePages : {}
    applyDrafts()
  } catch (error) {
    loadError.value = errMsg(error, 'loadFailed')
  } finally {
    loading.value = false
  }
}

const togglePage = (role, pid) => {
  const list = drafts[role] || []
  drafts[role] = list.includes(pid) ? list.filter((p) => p !== pid) : [...list, pid]
}

const resetRole = (role) => {
  drafts[role] = [...DEFAULT_ROLE_PAGES[role]]
}

const save = async () => {
  if (!isSuperAdmin.value || saving.value || !dirty.value) return
  saving.value = true
  try {
    // 仅提交发生变化的角色：
    // - 无存储且与默认一致 → 跳过
    // - 有存储但改回默认 → 提交 null（后端删除存储键，恢复默认）
    // - 其他 → 提交草稿数组
    const rolePages = {}
    for (const role of CONFIGURABLE_ROLES) {
      const base = isDefault(role) ? DEFAULT_ROLE_PAGES[role] : stored.value[role]
      if (sameList(base, drafts[role])) continue
      rolePages[role] = !isDefault(role) && sameList(DEFAULT_ROLE_PAGES[role], drafts[role])
        ? null
        : [...drafts[role]]
    }
    await $fetch('/api/admin/role-pages', { method: 'PUT', body: { rolePages } })
    // 回读校验
    const verified = await $fetch('/api/admin/role-pages')
    stored.value = verified?.rolePages && typeof verified.rolePages === 'object' ? verified.rolePages : {}
    applyDrafts()
    showToast(L('saved'), 'success')
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

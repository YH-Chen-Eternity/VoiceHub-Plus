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
          {{ isAdminOrAbove ? L('superAdminHint') : L('readOnlyHint') }}
        </span>
        <button
          class="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold bg-bg-primary-40 border border-border-secondary text-text-tertiary hover:text-text-primary hover:border-border-tertiary transition-all disabled:opacity-50"
          :disabled="loading"
          @click="loadAll"
        >
          <AppSpinner v-if="loading" :size="14" />
          <RefreshCw v-else :size="14" />
          {{ L('refresh') }}
        </button>
      </div>
    </div>

    <!-- 载入错误降级 -->
    <div
      v-if="loadError"
      class="flex items-start gap-3 p-4 rounded-2xl bg-error-10 border border-error-20 text-error text-xs font-medium"
    >
      <AlertCircle :size="16" class="shrink-0 mt-0.5" />
      <span>{{ loadError }}</span>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-16 text-xs text-text-tertiary">
      <AppSpinner :size="16" /> {{ L('loading') }}
    </div>

    <template v-else>
      <!-- 全站观察模式 -->
      <section class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div class="flex items-start gap-3 min-w-0">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-10 text-warning">
              <Eye :size="18" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-text-primary">{{ L('observeTitle') }}</h3>
              <p class="mt-1 text-[11px] leading-relaxed text-text-tertiary">{{ L('observeDesc') }}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="form.observeMode"
            class="relative h-5 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :class="form.observeMode ? 'bg-warning' : 'bg-bg-tertiary'"
            :disabled="!isAdminOrAbove"
            @click="askObserveToggle"
          >
            <span
              class="absolute top-1 h-3 w-3 rounded-full bg-bg-secondary transition-all"
              :class="form.observeMode ? 'left-6' : 'left-1'"
            />
          </button>
        </div>
        <div
          v-if="form.observeMode"
          class="flex items-start gap-3 rounded-xl border border-warning-20 bg-warning-10 p-4 text-xs font-bold text-warning"
        >
          <AlertTriangle :size="16" class="shrink-0 mt-0.5" />
          <span>{{ L('observeWarning') }}</span>
        </div>
      </section>

      <!-- 规则分组 -->
      <section
        v-for="group in groups"
        :key="group.id"
        class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4"
      >
        <button
          type="button"
          class="w-full flex items-center gap-3 text-left"
          @click="toggleGroup(group.id)"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-10 text-primary">
            <component :is="group.icon" :size="16" />
          </span>
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-black text-text-primary truncate">{{ groupTitle(group.id) }}</h3>
            <p class="mt-0.5 text-[10px] text-text-tertiary">
              {{ L('ruleCount') }} {{ group.switches.length + group.limits.length }} ·
              {{ L('hits24h') }} {{ groupHits(group) }}
            </p>
          </div>
          <ChevronUp v-if="openGroups[group.id]" :size="16" class="shrink-0 text-text-tertiary" />
          <ChevronDown v-else :size="16" class="shrink-0 text-text-tertiary" />
        </button>

        <div v-if="openGroups[group.id]" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- 开关型规则 -->
          <div
            v-for="rule in group.switches"
            :key="rule.key"
            class="rounded-xl border border-border-secondary bg-bg-primary-30 p-4 space-y-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-bold text-text-primary">{{ L('rule_' + rule.key + '_label') }}</p>
                <p class="mt-1 text-[10px] leading-relaxed text-text-tertiary">{{ L('rule_' + rule.key + '_desc') }}</p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="form.ruleSwitches[rule.key]"
                :aria-label="L('rule_' + rule.key + '_label')"
                class="relative h-5 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :class="form.ruleSwitches[rule.key] ? 'bg-primary-hover' : 'bg-bg-tertiary'"
                :disabled="!isAdminOrAbove"
                @click="form.ruleSwitches[rule.key] = !form.ruleSwitches[rule.key]"
              >
                <span
                  class="absolute top-1 h-3 w-3 rounded-full bg-bg-secondary transition-all"
                  :class="form.ruleSwitches[rule.key] ? 'left-6' : 'left-1'"
                />
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[10px] text-text-tertiary">
              <span class="inline-flex items-center gap-1 rounded-lg border border-border-secondary bg-bg-secondary-30 px-2 py-1 font-bold">
                <Activity :size="11" class="text-primary" />
                {{ L('hits24h') }} {{ statFor(rule.key).count24h }}
              </span>
              <span class="inline-flex items-center gap-1">
                <Clock :size="11" />
                {{ L('lastHit') }} {{ formatTime(statFor(rule.key).lastHit) }}
              </span>
            </div>
          </div>

          <!-- 阈值型规则 -->
          <div
            v-for="rule in group.limits"
            :key="rule.key"
            class="rounded-xl border border-border-secondary bg-bg-primary-30 p-4 space-y-3"
          >
            <div class="min-w-0">
              <p class="text-xs font-bold text-text-primary">{{ L('rule_' + rule.key + '_label') }}</p>
              <p class="mt-1 text-[10px] leading-relaxed text-text-tertiary">{{ L('rule_' + rule.key + '_desc') }}</p>
            </div>
            <div class="flex items-end gap-2">
              <label class="flex-1 space-y-1.5 block">
                <span class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ L('threshold') }}</span>
                <input
                  v-model.number="form.rateLimits[rule.key]"
                  type="number"
                  :min="rule.min"
                  :max="rule.max"
                  :disabled="!isAdminOrAbove"
                  class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2 text-xs text-text-primary focus:border-primary-30 focus:outline-none disabled:opacity-50"
                >
              </label>
              <span class="pb-2.5 text-[11px] font-bold text-text-tertiary whitespace-nowrap">{{ rule.unit }}</span>
            </div>
            <p class="px-1 text-[10px] text-text-disabled">
              {{ L('range') }} {{ rule.min }} – {{ rule.max }} · {{ L('defaultValue') }} {{ rule.defaultValue }}
            </p>
            <div class="flex flex-wrap items-center gap-2 text-[10px] text-text-tertiary">
              <span class="inline-flex items-center gap-1 rounded-lg border border-border-secondary bg-bg-secondary-30 px-2 py-1 font-bold">
                <Activity :size="11" class="text-primary" />
                {{ L('hits24h') }} {{ statFor(rule.key).count24h }}
              </span>
              <span class="inline-flex items-center gap-1">
                <Clock :size="11" />
                {{ L('lastHit') }} {{ formatTime(statFor(rule.key).lastHit) }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- 并入区：地域闸 -->
      <section class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-10 text-primary">
              <Globe :size="16" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-text-primary">{{ L('geoTitle') }}</h3>
              <p class="mt-1 text-[11px] leading-relaxed text-text-tertiary">{{ L('geoDesc') }}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="geoEnabled"
            class="relative h-5 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :class="geoEnabled ? 'bg-primary-hover' : 'bg-bg-tertiary'"
            :disabled="!isAdminOrAbove || geoBusy"
            @click="askGeoToggle"
          >
            <span
              class="absolute top-1 h-3 w-3 rounded-full bg-bg-secondary transition-all"
              :class="geoEnabled ? 'left-6' : 'left-1'"
            />
          </button>
        </header>

        <!-- 三档姿态 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div
            v-for="posture in geoPostures"
            :key="posture.id"
            class="rounded-xl border p-3 space-y-1"
            :class="posture.active ? 'border-primary-30 bg-primary-10' : 'border-border-secondary bg-bg-primary-30'"
          >
            <div class="flex items-center gap-2">
              <component :is="posture.icon" :size="14" :class="posture.active ? 'text-primary' : 'text-text-disabled'" />
              <p class="text-[11px] font-bold" :class="posture.active ? 'text-primary' : 'text-text-tertiary'">{{ posture.label }}</p>
              <span v-if="posture.active" class="ml-auto text-[9px] font-black uppercase tracking-widest text-primary">{{ L('current') }}</span>
            </div>
            <p class="text-[10px] leading-relaxed text-text-tertiary">{{ posture.desc }}</p>
          </div>
        </div>

        <p v-if="geoUnknown" class="flex items-center gap-2 text-[11px] text-warning">
          <AlertCircle :size="14" /> {{ L('geoUnknown') }}
        </p>
        <p v-if="geoError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ geoError }}
        </p>
      </section>

      <!-- 并入区：封禁 IP -->
      <section class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-error-10 text-error">
              <Ban :size="16" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-text-primary">{{ L('banTitle') }}</h3>
              <p class="mt-1 text-[11px] leading-relaxed text-text-tertiary">{{ L('banDesc') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="banInput"
              :placeholder="L('banPlaceholder')"
              :disabled="!isAdminOrAbove"
              class="w-44 rounded-xl border border-border-secondary bg-bg-primary-30 px-3 py-2 text-[11px] text-text-primary outline-none focus:border-primary disabled:opacity-50"
              @keyup.enter="askBanIp"
            >
            <button
              class="px-3 py-2 rounded-xl text-[11px] font-bold bg-error text-white hover:opacity-90 disabled:opacity-50"
              :disabled="!isAdminOrAbove || banBusy"
              @click="askBanIp"
            >
              {{ L('banButton') }}
            </button>
          </div>
        </header>

        <p v-if="bansError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ bansError }}
        </p>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div
            v-for="bucket in banBuckets"
            :key="bucket.key"
            class="rounded-xl border border-border-secondary bg-bg-primary-30 p-4 space-y-3"
          >
            <h4 class="text-[11px] font-black uppercase tracking-wider text-text-tertiary flex items-center gap-2">
              <component :is="bucket.icon" :size="14" :class="bucket.tone" /> {{ L(bucket.key) }}
              <span class="ml-auto text-text-disabled">{{ bans[bucket.key].length }}</span>
            </h4>
            <p v-if="!bans[bucket.key].length" class="text-[11px] text-text-disabled py-4 text-center">{{ L('empty') }}</p>
            <ul v-else class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
              <li
                v-for="item in bans[bucket.key]"
                :key="`${bucket.key}-${item.ip || item.fp}`"
                class="flex items-start gap-2 rounded-lg border border-border-secondary bg-bg-secondary-30 px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold text-text-primary break-all">{{ item.ip || item.fp }}</p>
                  <p class="mt-0.5 text-[10px] text-text-tertiary">
                    {{ bucket.key === 'permanent' ? `${L('banCount')} ${item.count || 0} · ` : '' }}{{ formatTime(item.at || item.until) }}
                  </p>
                  <p v-if="item.detail" class="mt-0.5 text-[10px] text-text-disabled break-all">{{ item.detail }}</p>
                </div>
                <button
                  v-if="isAdminOrAbove"
                  class="shrink-0 text-[10px] font-bold text-primary hover:text-primary-hover disabled:opacity-50"
                  :disabled="banBusy"
                  @click="askUnban(bucket.key === 'fps' ? 'fp' : 'ip', bucket.key === 'fps' ? item.fp : item.ip)"
                >
                  {{ L('unban') }}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 并入区：可信 IP -->
      <section class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success-10 text-success">
              <ShieldCheck :size="16" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-text-primary">{{ L('trustedTitle') }}</h3>
              <p class="mt-1 text-[11px] leading-relaxed text-text-tertiary">{{ L('trustedDesc') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="trustedInput"
              :placeholder="L('trustedPlaceholder')"
              :disabled="!isAdminOrAbove"
              class="w-44 rounded-xl border border-border-secondary bg-bg-primary-30 px-3 py-2 text-[11px] text-text-primary outline-none focus:border-primary disabled:opacity-50"
              @keyup.enter="addTrustedIp"
            >
            <button
              class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
              :disabled="!isAdminOrAbove || trustedBusy"
              @click="addTrustedIp"
            >
              <Plus :size="13" /> {{ L('trustedAdd') }}
            </button>
          </div>
        </header>

        <p v-if="trustedError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ trustedError }}
        </p>
        <p v-if="!trustedIps.length && !trustedError" class="py-4 text-center text-xs text-text-disabled">{{ L('trustedEmpty') }}</p>
        <ul v-else class="flex flex-wrap gap-2">
          <li
            v-for="ip in trustedIps"
            :key="ip"
            class="flex items-center gap-2 rounded-lg border border-border-secondary bg-bg-primary-30 px-3 py-1.5"
          >
            <span class="text-xs font-bold text-text-primary break-all">{{ ip }}</span>
            <button
              v-if="isAdminOrAbove"
              class="text-[10px] font-bold text-error hover:opacity-80 disabled:opacity-50"
              :disabled="trustedBusy"
              @click="removeTrustedIp(ip)"
            >
              <Trash2 :size="13" />
            </button>
          </li>
        </ul>
      </section>

      <!-- 并入区：Bot 评分 -->
      <section class="rounded-2xl border border-border-secondary bg-bg-secondary-40 p-5 space-y-4">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-10 text-primary">
              <Bot :size="16" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-text-primary">{{ L('botTitle') }}</h3>
              <p class="mt-1 text-[11px] leading-relaxed text-text-tertiary">{{ L('botDesc') }}</p>
            </div>
          </div>
          <div class="relative">
            <Search :size="13" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" />
            <input
              v-model="botFilter"
              :placeholder="L('botSearchPlaceholder')"
              class="w-52 rounded-xl border border-border-secondary bg-bg-primary-30 py-2 pl-8 pr-3 text-[11px] text-text-primary outline-none focus:border-primary"
            >
          </div>
        </header>

        <p v-if="botError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ botError }}
        </p>
        <div v-if="!filteredBotScores.length && !botError" class="py-8 text-center text-xs text-text-disabled">{{ L('botEmpty') }}</div>
        <div v-else class="overflow-auto custom-scrollbar max-h-[420px]">
          <table class="w-full min-w-[860px] text-left text-xs">
            <thead class="sticky top-0 z-10 bg-bg-secondary-40">
              <tr class="text-[10px] uppercase tracking-wider text-text-disabled border-b border-border-secondary">
                <th class="py-2 pr-3 font-semibold">{{ L('botAccount') }}</th>
                <th class="py-2 pr-3 font-semibold">{{ L('botIp') }}</th>
                <th class="py-2 pr-3 font-semibold">{{ L('botScore') }}</th>
                <th class="py-2 pr-3 font-semibold">{{ L('botReasons') }}</th>
                <th class="py-2 pr-3 font-semibold">{{ L('botSignals') }}</th>
                <th class="py-2 font-semibold">{{ L('botLastSeen') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in filteredBotScores"
                :key="row.key"
                class="border-b border-border-secondary/60 align-top hover:bg-bg-secondary-20"
              >
                <td class="py-2 pr-3 font-semibold text-text-primary break-all">{{ row.account || '-' }}</td>
                <td class="py-2 pr-3 text-text-tertiary break-all">{{ row.ip || '-' }}</td>
                <td class="py-2 pr-3">
                  <span :class="['inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border', botTone(row.score)]">
                    {{ Number(row.score || 0).toFixed(1) }}
                  </span>
                </td>
                <td class="py-2 pr-3 text-text-tertiary break-all max-w-[220px]">{{ (row.reasons || []).join(', ') || '-' }}</td>
                <td class="py-2 pr-3 text-text-tertiary whitespace-nowrap">{{ row.reports || 0 }} / {{ row.human || 0 }} / {{ row.signed || 0 }} / {{ row.unsigned || 0 }}</td>
                <td class="py-2 whitespace-nowrap text-text-tertiary">{{ formatTime(row.last) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 底部操作栏 -->
      <div class="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-border-secondary bg-bg-secondary-40 p-3">
        <span v-if="dirty" class="mr-auto flex items-center gap-2 px-2 text-[11px] font-bold text-warning">
          <AlertCircle :size="14" /> {{ L('unsaved') }}
        </span>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border-secondary text-xs font-bold text-text-secondary hover:text-text-primary hover:border-border-tertiary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isAdminOrAbove || saving"
          @click="askRestore"
        >
          <RotateCcw :size="14" /> {{ L('restore') }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-[var(--primary-glow-20)] transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isAdminOrAbove || saving"
          @click="save"
        >
          <Save :size="14" :class="{ 'animate-pulse': saving }" />
          {{ saving ? L('saving') : L('save') }}
        </button>
      </div>
    </template>

    <ConfirmDialog
      v-model:show="confirmState.show"
      :title="confirmState.title"
      :message="confirmState.message"
      :type="confirmState.type"
      :loading="confirmState.loading"
      @confirm="runConfirm"
      @cancel="confirmState.show = false"
    />
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, reactive, ref } from 'vue'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Ban,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  Fingerprint,
  Gauge,
  Globe,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2
} from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import { useLocale } from '~/utils/locale'
import AppSpinner from '~/components/UI/Common/AppSpinner.vue'
import { useToast } from '~/composables/useToast'
import { usePermissions } from '~/composables/usePermissions'
import { formatDateTime } from '~/utils/timeUtils'

defineOptions({ name: 'AdminEdgeProtection' })

const { showToast } = useToast()
const { isAdminOrAbove } = usePermissions()
const { admin } = useLocale()
const t = computed(() => admin.value?.edgeProtection || {})

// 文案统一来自共享双语词典 admin.*，键缺失时显示键名，避免英文环境回退中文。
const L = (key) => {
  const value = t.value?.[key]
  return value === undefined || value === null || value === '' ? key : value
}

// 与 server/config/edgeRules.ts 的 DEFAULT_EDGE_CONFIG 逐项保持一致。
// rewriter 为独立无构建容器，Vue 端无法直接 import server TS，故内置一份镜像常量。
// region 默认 false：地域闸由 GEO_GATE==='1' 显式开启，恢复默认不应意外收紧全站来源。
const DEFAULT_SWITCHES = {
  script: true,
  brute_force: true,
  enumeration: true,
  banned: true,
  region: false,
  bot: true,
  sameOrigin: true
}
// 默认值取自 deploy/rewriter/app-rewriter.js 顶层常量
const DEFAULT_LIMITS = {
  RL_MUSIC_PER_MIN: 60,
  RL_AUTH_PER_MIN: 30,
  RL_SEARCH_PER_MIN: 60,
  RL_ADMIN_PER_MIN: 120,
  RL_GLOBAL_PER_MIN: 1800,
  ATK_LOGIN_MAX: 45,
  ATK_FAIL_MAX: 18,
  ATK_SEARCH_MAX: 20,
  ATK_PERMA_FAILS: 30,
  BOT_BLOCK_SCORE: 9
}
// min/max 必须与 server/config/edgeRules.ts 的 EDGE_RATE_LIMIT_META 逐项一致，
// 否则会出现「前端可填、后端 400」。后端是唯一事实来源。
const LIMIT_META = {
  RL_MUSIC_PER_MIN: { min: 10, max: 100000, unit: '次/分钟' },
  RL_AUTH_PER_MIN: { min: 5, max: 100000, unit: '次/分钟' },
  RL_SEARCH_PER_MIN: { min: 10, max: 100000, unit: '次/分钟' },
  RL_ADMIN_PER_MIN: { min: 10, max: 100000, unit: '次/分钟' },
  RL_GLOBAL_PER_MIN: { min: 100, max: 1000000, unit: '次/分钟' },
  ATK_LOGIN_MAX: { min: 3, max: 10000, unit: '次/10分钟' },
  ATK_FAIL_MAX: { min: 3, max: 10000, unit: '次' },
  ATK_SEARCH_MAX: { min: 3, max: 10000, unit: '次/分钟' },
  ATK_PERMA_FAILS: { min: 3, max: 100000, unit: '次/小时' },
  BOT_BLOCK_SCORE: { min: 1, max: 100, unit: '分' }
}
const GROUP_DEF = [
  { id: 'script', icon: ShieldAlert, switches: ['script', 'sameOrigin'], limits: [] },
  { id: 'bruteforce', icon: Lock, switches: ['brute_force', 'enumeration'], limits: [] },
  { id: 'geo', icon: Globe, switches: ['region', 'bot', 'banned'], limits: [] },
  { id: 'rate', icon: Gauge, switches: [], limits: Object.keys(DEFAULT_LIMITS) }
]
const groups = computed(() => GROUP_DEF.map(group => ({
  id: group.id,
  icon: group.icon,
  switches: group.switches.map(key => ({ key })),
  limits: group.limits.map(key => ({
    key,
    ...LIMIT_META[key],
    defaultValue: DEFAULT_LIMITS[key]
  }))
})))
const groupTitle = (id) => L(`group_${id}`)

const form = reactive({
  observeMode: false,
  ruleSwitches: { ...DEFAULT_SWITCHES },
  rateLimits: { ...DEFAULT_LIMITS }
})
const baseline = ref('')
const snapshot = () => ({
  observeMode: !!form.observeMode,
  ruleSwitches: Object.fromEntries(
    Object.keys(DEFAULT_SWITCHES).map(key => [key, !!form.ruleSwitches[key]])
  ),
  rateLimits: Object.fromEntries(
    Object.keys(DEFAULT_LIMITS).map(key => {
      const value = Number(form.rateLimits[key])
      return [key, Number.isFinite(value) ? value : DEFAULT_LIMITS[key]]
    })
  )
})
const applyConfig = (cfg) => {
  form.observeMode = !!cfg?.observeMode
  form.ruleSwitches = Object.fromEntries(
    Object.keys(DEFAULT_SWITCHES).map(key => [
      key,
      cfg?.ruleSwitches?.[key] === undefined ? DEFAULT_SWITCHES[key] : !!cfg.ruleSwitches[key]
    ])
  )
  form.rateLimits = Object.fromEntries(
    Object.keys(DEFAULT_LIMITS).map(key => {
      const value = Number(cfg?.rateLimits?.[key])
      return [key, Number.isFinite(value) && value >= 0 ? value : DEFAULT_LIMITS[key]]
    })
  )
}
const dirty = computed(() => JSON.stringify(snapshot()) !== baseline.value)

const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const configLoaded = ref(false)
const stats = reactive({ perRule: [] })
const openGroups = reactive(Object.fromEntries(GROUP_DEF.map(group => [group.id, true])))
const toggleGroup = (id) => { openGroups[id] = !openGroups[id] }
const statFor = (kind) => {
  const hit = stats.perRule.find(row => row.kind === kind)
  return {
    count24h: hit && Number.isFinite(Number(hit.count24h)) ? Number(hit.count24h) : 0,
    lastHit: hit?.lastHit || null
  }
}
const groupHits = (group) => [...group.switches, ...group.limits]
  .reduce((total, rule) => total + statFor(rule.key).count24h, 0)

const formatTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : formatDateTime(date)
}

const errMsg = (error, key) => error?.data?.message || L(key)

// 并入区状态
const geoEnabled = ref(false)
const geoUnknown = ref(false)
const geoBusy = ref(false)
const geoError = ref('')
const geoPostures = computed(() => [
  {
    id: 'observe',
    icon: Eye,
    label: L('postureObserve'),
    desc: L('postureObserveDesc'),
    active: !!form.observeMode
  },
  {
    id: 'cn',
    icon: Globe,
    label: L('postureCn'),
    desc: L('postureCnDesc'),
    active: !form.observeMode && geoEnabled.value
  },
  {
    id: 'open',
    icon: ShieldCheck,
    label: L('postureOpen'),
    desc: L('postureOpenDesc'),
    active: !form.observeMode && !geoEnabled.value
  }
])

const bans = reactive({ permanent: [], locks: [], fps: [] })
const bansError = ref('')
const banInput = ref('')
const banBusy = ref(false)
const banBuckets = [
  { key: 'permanent', icon: Ban, tone: 'text-error' },
  { key: 'locks', icon: Lock, tone: 'text-warning' },
  { key: 'fps', icon: Fingerprint, tone: 'text-primary' }
]

const trustedIps = ref([])
const trustedInput = ref('')
const trustedBusy = ref(false)
const trustedError = ref('')

const botScores = ref([])
const botError = ref('')
const botFilter = ref('')
const filteredBotScores = computed(() => {
  const keyword = botFilter.value.trim().toLowerCase()
  if (!keyword) return botScores.value
  return botScores.value.filter(row => String(row.account || '').toLowerCase().includes(keyword))
})
const botTone = (score) => {
  const value = Number(score || 0)
  if (value >= 9) return 'bg-error-10 text-error border-error-20'
  if (value >= 5) return 'bg-warning-10 text-warning border-warning-20'
  return 'bg-primary-10 text-primary border-primary-20'
}

// 每个数据源独立降级：单个接口失败不阻断整页，也不抛到全局。
const loadConfig = async () => {
  const result = await $fetch('/api/admin/edge-config')
  applyConfig(result)
  baseline.value = JSON.stringify(snapshot())
  configLoaded.value = true
}
const loadStats = async () => {
  const result = await $fetch('/api/admin/edge-stats')
  stats.perRule = Array.isArray(result?.perRule) ? result.perRule : []
}
const loadGeo = async () => {
  geoError.value = ''
  geoUnknown.value = false
  try {
    const result = await $fetch('/api/admin/geo-lock')
    geoEnabled.value = !!result?.enabled
  } catch {
    // 现有 /api/admin/geo-lock 仅有 POST，无 GET；读取失败时只标注状态未知。
    geoUnknown.value = true
  }
}
const loadBans = async () => {
  bansError.value = ''
  try {
    const result = await $fetch('/api/admin/permanent-bans')
    bans.permanent = Array.isArray(result?.permanent) ? result.permanent : []
    bans.locks = Array.isArray(result?.locks) ? result.locks : []
    bans.fps = Array.isArray(result?.fps) ? result.fps : []
  } catch (error) {
    bansError.value = errMsg(error, 'loadFailed')
  }
}
const loadTrusted = async () => {
  trustedError.value = ''
  try {
    const result = await $fetch('/api/admin/trusted-ips')
    trustedIps.value = Array.isArray(result?.ips) ? result.ips : []
  } catch (error) {
    trustedError.value = errMsg(error, 'trustedFailed')
  }
}
const loadBotScores = async () => {
  botError.value = ''
  try {
    const result = await $fetch('/api/admin/bot-scores')
    botScores.value = Array.isArray(result?.scores) ? result.scores : []
  } catch (error) {
    botError.value = errMsg(error, 'botFailed')
  }
}

let lastLoadAt = 0
const loadAll = async () => {
  // onMounted 与 onActivated 可能同时触发（KeepAlive），做一次轻量节流。
  const now = Date.now()
  if (now - lastLoadAt < 800) return
  lastLoadAt = now
  loading.value = true
  loadError.value = ''
  try {
    await Promise.all([
      loadConfig().catch(error => {
        configLoaded.value = false
        loadError.value = errMsg(error, 'loadFailed')
        // 配置读取失败时不要把内置默认值误判成「未保存更改」
        baseline.value = JSON.stringify(snapshot())
      }),
      loadStats().catch(() => { stats.perRule = [] }),
      loadGeo(),
      loadBans(),
      loadTrusted(),
      loadBotScores()
    ])
  } catch (error) {
    // 各数据源已各自降级，这里兜底避免 Promise.all 的 rejection 外抛
    loadError.value = errMsg(error, 'loadFailed')
  } finally {
    loading.value = false
  }
}

// 通用二次确认
const confirmState = reactive({ show: false, title: '', message: '', type: 'warning', loading: false, action: null })
const askConfirm = (options) => {
  confirmState.title = options.title
  confirmState.message = options.message
  confirmState.type = options.type || 'warning'
  confirmState.action = options.action
  confirmState.show = true
}
const runConfirm = async () => {
  confirmState.loading = true
  try {
    await confirmState.action?.()
    confirmState.show = false
  } catch (error) {
    // action 内部已各自降级；这里兜底避免异常外抛到全局
    showToast(errMsg(error, 'saveFailed'), 'error')
  } finally {
    confirmState.loading = false
  }
}

const askObserveToggle = () => {
  if (!isAdminOrAbove.value) return
  const next = !form.observeMode
  askConfirm({
    title: L('observeConfirmTitle'),
    message: next ? L('observeConfirmOn') : L('observeConfirmOff'),
    type: next ? 'danger' : 'warning',
    action: () => { form.observeMode = next }
  })
}
const askRestore = () => {
  if (!isAdminOrAbove.value) return
  askConfirm({
    title: L('restoreConfirmTitle'),
    message: L('restoreConfirmMsg'),
    type: 'warning',
    action: () => {
      form.observeMode = false
      form.ruleSwitches = { ...DEFAULT_SWITCHES }
      form.rateLimits = { ...DEFAULT_LIMITS }
      showToast(L('unsaved'), 'info')
    }
  })
}

const save = async () => {
  if (!isAdminOrAbove.value || saving.value) return
  if (!configLoaded.value) {
    showToast(L('loadFailed'), 'error')
    return
  }
  saving.value = true
  const body = snapshot()
  try {
    await $fetch('/api/admin/edge-config', { method: 'PUT', body })
    // 保存后回读校验
    const verified = await $fetch('/api/admin/edge-config')
    applyConfig(verified)
    const verifiedSnapshot = snapshot()
    baseline.value = JSON.stringify(verifiedSnapshot)
    if (JSON.stringify(verifiedSnapshot) !== JSON.stringify(body)) {
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

const askGeoToggle = () => {
  if (!isAdminOrAbove.value || geoBusy.value) return
  const next = !geoEnabled.value
  askConfirm({
    title: L('geoConfirmTitle'),
    message: next ? L('geoConfirmOn') : L('geoConfirmOff'),
    type: 'warning',
    action: async () => {
      geoBusy.value = true
      geoError.value = ''
      try {
        const result = await $fetch('/api/admin/geo-lock', {
          method: 'POST',
          body: { enabled: next }
        })
        geoEnabled.value = !!result?.enabled
        geoUnknown.value = false
      } catch (error) {
        geoError.value = errMsg(error, 'geoFailed')
      } finally {
        geoBusy.value = false
      }
    }
  })
}

const askBanIp = () => {
  if (!isAdminOrAbove.value || banBusy.value) return
  const ip = banInput.value.trim()
  if (!ip) return
  askConfirm({
    title: L('banConfirmTitle'),
    message: `${L('banConfirmMsg')} ${ip}`,
    type: 'danger',
    action: async () => {
      banBusy.value = true
      try {
        await $fetch('/api/admin/ban-ip', {
          method: 'POST',
          body: { ip, detail: 'banned from edge protection panel' }
        })
        showToast(`${L('banSuccess')} ${ip}`, 'success')
        banInput.value = ''
        await Promise.all([loadBans(), loadBotScores()])
      } catch (error) {
        showToast(errMsg(error, 'banFailed'), 'error')
      } finally {
        banBusy.value = false
      }
    }
  })
}
const askUnban = (type, value) => {
  if (!isAdminOrAbove.value || banBusy.value || !value) return
  askConfirm({
    title: L('unbanConfirmTitle'),
    message: `${L('unbanConfirmMsg')} ${value}`,
    type: 'warning',
    action: async () => {
      banBusy.value = true
      try {
        await $fetch('/api/admin/permanent-bans', {
          method: 'POST',
          body: { type, value }
        })
        showToast(L('unbanSuccess'), 'success')
        await loadBans()
      } catch (error) {
        showToast(errMsg(error, 'unbanFailed'), 'error')
      } finally {
        banBusy.value = false
      }
    }
  })
}

const updateTrustedIp = async (action, ip) => {
  if (!isAdminOrAbove.value || trustedBusy.value) return
  trustedBusy.value = true
  trustedError.value = ''
  try {
    const result = await $fetch('/api/admin/trusted-ips', {
      method: 'POST',
      body: { action, ip }
    })
    trustedIps.value = Array.isArray(result?.ips) ? result.ips : []
    if (action === 'add') trustedInput.value = ''
  } catch (error) {
    trustedError.value = errMsg(error, 'trustedFailed')
  } finally {
    trustedBusy.value = false
  }
}
const addTrustedIp = () => {
  const ip = trustedInput.value.trim()
  if (ip) updateTrustedIp('add', ip)
}
const removeTrustedIp = (ip) => updateTrustedIp('remove', ip)

// no-store 数据：每次进入页面（重新挂载）都重新拉取
onMounted(loadAll)
onActivated(loadAll)
</script>

<style scoped></style>

<template>
  <div class="turnstile-widget">
    <div ref="containerRef"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useSiteConfig } from '~/composables/useSiteConfig'

declare global {
  interface Window {
    turnstile: any
  }
}

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { siteConfig } = useSiteConfig()
const containerRef = ref<HTMLElement | null>(null)
let widgetId: string | null = null
let retryCount = 0
const MAX_RETRIES = 50 // 最大重试 50 次，每次 100ms，共 5 秒
let retryTimer: ReturnType<typeof setTimeout> | null = null

// 容器是 v-if 渲染出来的，配置到位时容器可能还没挂上；等 DOM 更新后再渲染，
// 否则 renderWidget 会因为 containerRef 为空直接返回，之后再也没有触发点（表现为验证码永不出现）。
watch(
  [() => siteConfig.value.turnstileSiteKey, containerRef],
  ([siteKey, el]) => {
    if (siteKey && el && widgetId === null) {
      renderWidget()
    }
  },
  { immediate: true, flush: 'post' }
)

function renderWidget() {
  // onMounted 与 watch 都可能是触发点，同一时刻只保留一条重试链，避免重试预算被双倍消耗
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  if (!containerRef.value || !siteConfig.value.turnstileSiteKey || widgetId !== null) return

  // 确保全局存在 turnstile 对象
  if (window.turnstile) {
    widgetId = window.turnstile.render(containerRef.value, {
      sitekey: siteConfig.value.turnstileSiteKey,
      callback: (token: string) => {
        emit('update:modelValue', token)
      },
      'error-callback': () => {
        emit('update:modelValue', '')
      },
      'expired-callback': () => {
        emit('update:modelValue', '')
      }
    })
  } else if (retryCount < MAX_RETRIES) {
    // 如果还没加载好，且未超过最大重试次数，稍微等一下
    retryCount++
    retryTimer = setTimeout(renderWidget, 100)
  } else {
    console.error('Failed to load Turnstile script: timeout exceeded.')
  }
}

const reset = () => {
  if (widgetId !== null && window.turnstile) {
    window.turnstile.reset(widgetId)
    emit('update:modelValue', '')
  }
}

/**
 * 主动取一次当前 token。
 * Cloudflare 完成校验到回调触发之间有延迟，提交瞬间 v-model 可能还是空的；
 * 直接问 Cloudflare 能拿到已经生成、但回调尚未送达的 token。
 */
const getToken = (): string => {
  if (widgetId === null || !window.turnstile?.getResponse) return ''
  try {
    return window.turnstile.getResponse(widgetId) || ''
  } catch {
    return ''
  }
}

/** 控件是否已经渲染（用于区分「还在加载」和「已就绪但未通过」） */
const isReady = () => widgetId !== null

defineExpose({
  reset,
  getToken,
  isReady
})

onMounted(() => {
  // 如果之前没有加载过 Turnstile 脚本，则动态加载
  if (!document.getElementById('turnstile-script')) {
    const script = document.createElement('script')
    script.id = 'turnstile-script'
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    document.head.appendChild(script)
    
    // 监听加载成功
    script.onload = () => {
      renderWidget()
    }
  } else {
    renderWidget()
  }
})

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer)
  if (widgetId !== null && window.turnstile) {
    window.turnstile.remove(widgetId)
  }
  // 不置空的话，组件重新挂载时 renderWidget 会以为旧控件还在，永远不再渲染
  widgetId = null
  retryCount = 0
})
</script>

<style scoped>
.turnstile-widget {
  display: flex;
  justify-content: center;
  margin-top: 8px;
  margin-bottom: 8px;
}
</style>

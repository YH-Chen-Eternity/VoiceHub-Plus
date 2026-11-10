<template>
  <Teleport to="body">
    <Transition name="community-fade">
      <div
        v-if="open"
        class="civ"
        role="dialog"
        aria-modal="true"
        :aria-label="t.viewerLabel"
        @click.self="onBackdrop"
      >
        <div class="civ-topbar">
          <button class="civ-icon-btn" type="button" :aria-label="t.viewerClose" @click="emit('close')">
            <X :size="22" />
          </button>
          <span v-if="images.length > 1" class="civ-counter">{{ index + 1 }} / {{ images.length }}</span>
          <span v-else class="civ-counter civ-counter--plain">{{ t.imageSingle }}</span>
          <button
            v-if="canDownload"
            class="civ-text-btn"
            type="button"
            :disabled="downloading"
            :aria-label="t.downloadImage"
            @click="downloadImage"
          >
            <Loader2 v-if="downloading" class="animate-spin" :size="17" />
            <Download v-else :size="17" />
            <span class="civ-btn-label">{{ t.downloadImage }}</span>
          </button>
          <span v-else class="civ-topbar-spacer" />
        </div>

        <div
          ref="stage"
          class="civ-stage"
          :class="{ 'is-dragging': dragging, 'is-zoomed': scale > 1 }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @dblclick="onDoubleClick"
        >
          <img
            :key="currentSrc"
            class="civ-img"
            :class="{ 'is-zoomed': scale > 1 }"
            :src="currentSrc"
            :alt="t.imageAlt"
            :style="imgStyle"
            draggable="false"
            @load="onImgLoad"
            @error="onImgError"
            @click.stop
          >
          <div v-if="originalLoading" class="civ-loading">
            <Loader2 class="animate-spin" :size="26" />
            <span>{{ t.originalLoading }}</span>
          </div>
          <div v-if="imageError" class="civ-error">{{ t.imageLoadFailed }}</div>
        </div>

        <button
          v-if="images.length > 1"
          class="civ-nav civ-nav-prev"
          type="button"
          :aria-label="t.viewerPrevious"
          @click.stop="step(-1)"
        >
          <ChevronLeft :size="26" />
        </button>
        <button
          v-if="images.length > 1"
          class="civ-nav civ-nav-next"
          type="button"
          :aria-label="t.viewerNext"
          @click.stop="step(1)"
        >
          <ChevronRight :size="26" />
        </button>

        <div class="civ-bottombar">
          <button
            class="civ-original-btn"
            :class="{ 'is-active': showOriginal }"
            type="button"
            :disabled="showOriginal"
            @click="viewOriginal"
          >
            <ZoomIn :size="16" />
            <span>{{ showOriginal ? t.originalShown : t.viewOriginal }}</span>
          </button>
          <span class="civ-hint">{{ t.viewerHint }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  X,
  ZoomIn
} from '@lucide/vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'

const props = defineProps({
  open: { type: Boolean, default: false },
  images: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
  canDownload: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'update:index', 'need-login'])

const { community } = useLocale()
const t = computed(() => community.value || {})
const { showToast } = useToast()

const MIN_SCALE = 1
const MAX_SCALE = 6
const DOUBLE_TAP_SCALE = 2.5

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)
const showOriginal = ref(false)
const originalLoading = ref(false)
const imageError = ref(false)
const downloading = ref(false)
const stage = ref(null)

function withVariant(url, variant) {
  if (!url) return ''
  return `${url}${String(url).includes('?') ? '&' : '?'}variant=${variant}`
}
function withQuery(url, key) {
  if (!url) return ''
  return `${url}${String(url).includes('?') ? '&' : '?'}${key}`
}

const baseUrl = computed(() => props.images[props.index]?.url || '')
// 默认展示更小的预览图；点「查看原图」后切换到压缩后 ≤3MB 的原图
const currentSrc = computed(() =>
  showOriginal.value ? baseUrl.value : withVariant(baseUrl.value, 'preview')
)
const imgStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  cursor: scale.value > 1 ? 'grab' : 'zoom-in'
}))

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}
function boundTranslate() {
  if (scale.value <= MIN_SCALE) {
    tx.value = 0
    ty.value = 0
    return
  }
  const width = stage.value?.clientWidth || 0
  const height = stage.value?.clientHeight || 0
  const maxX = ((scale.value - 1) * width) / 2
  const maxY = ((scale.value - 1) * height) / 2
  tx.value = Math.min(maxX, Math.max(-maxX, tx.value))
  ty.value = Math.min(maxY, Math.max(-maxY, ty.value))
}
function resetTransform() {
  scale.value = MIN_SCALE
  tx.value = 0
  ty.value = 0
}

// 统一用 Pointer Events 处理鼠标与触摸：支持双指捏合、单指拖拽（仅放大后）
const pointers = new Map()
let pinchStartDist = 0
let pinchStartScale = 1
let dragStart = null

function onPointerDown(event) {
  if (event.button != null && event.button !== 0) return
  stage.value?.setPointerCapture?.(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y)
    pinchStartScale = scale.value
    dragStart = null
  } else if (pointers.size === 1) {
    dragStart = { x: event.clientX, y: event.clientY, tx: tx.value, ty: ty.value }
  }
}

function onPointerMove(event) {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinchStartDist > 0) {
      scale.value = clampScale((pinchStartScale * dist) / pinchStartDist)
      boundTranslate()
    }
    return
  }
  if (pointers.size === 1 && scale.value > MIN_SCALE && dragStart) {
    dragging.value = true
    tx.value = dragStart.tx + (event.clientX - dragStart.x)
    ty.value = dragStart.ty + (event.clientY - dragStart.y)
    boundTranslate()
  }
}

function onPointerUp(event) {
  pointers.delete(event.pointerId)
  if (pointers.size < 2) pinchStartDist = 0
  if (pointers.size === 1) {
    const p = [...pointers.values()][0]
    dragStart = { x: p.x, y: p.y, tx: tx.value, ty: ty.value }
  } else if (pointers.size === 0) {
    dragging.value = false
    dragStart = null
    if (scale.value <= MIN_SCALE + 0.02) resetTransform()
  }
}

function onDoubleClick() {
  if (scale.value > MIN_SCALE) resetTransform()
  else {
    scale.value = DOUBLE_TAP_SCALE
    boundTranslate()
  }
}

function onWheel(event) {
  event.preventDefault()
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
  scale.value = clampScale(scale.value * factor)
  boundTranslate()
}

function onBackdrop() {
  // 仅在未放大时点背景关闭，避免拖拽放大后误触
  if (scale.value <= MIN_SCALE) emit('close')
}

function step(delta) {
  const total = props.images.length
  if (total < 2) return
  emit('update:index', (props.index + delta + total) % total)
}

function viewOriginal() {
  if (showOriginal.value || !baseUrl.value) return
  showOriginal.value = true
  originalLoading.value = true
  imageError.value = false
}

function onImgLoad() {
  originalLoading.value = false
  imageError.value = false
}
function onImgError() {
  originalLoading.value = false
  imageError.value = true
}

async function downloadImage() {
  if (!props.canDownload) {
    emit('need-login')
    return
  }
  if (!baseUrl.value || downloading.value) return
  downloading.value = true
  try {
    const response = await fetch(withQuery(baseUrl.value, 'download=1'), {
      credentials: 'same-origin'
    })
    if (!response.ok) throw new Error(String(response.status))
    const contentTypeHeader = String(response.headers.get('content-type') || '')
    // 防御：服务端异常时可能返回 HTML 错误页，避免把它存成损坏的图片文件
    if (!contentTypeHeader.startsWith('image/')) throw new Error('not-image')
    const blob = await response.blob()
    // 双重校验：blob.type 来自实际响应，防止头部与内容不一致的异常响应被存为损坏文件
    if (!blob.type.startsWith('image/')) throw new Error('not-image')
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    // 扩展名跟随响应实际格式：历史 base64 数据可能是 JPEG/PNG，不能固定 .webp
    const contentType = blob.type || contentTypeHeader
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('jpeg') || contentType.includes('jpg')
        ? 'jpg'
        : contentType.includes('gif')
          ? 'gif'
          : 'webp'
    anchor.href = objectUrl
    anchor.download = `voicehub-image-${props.images[props.index]?.id || 'image'}.${ext}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch {
    showToast(t.value.downloadFailed || '下载失败，请重试', 'error')
  } finally {
    downloading.value = false
  }
}

function onKey(event) {
  if (!props.open) return
  if (event.key === 'ArrowLeft') step(-1)
  else if (event.key === 'ArrowRight') step(1)
}

// 切图、关闭时重置缩放与「查看原图」状态，避免上一张的放大位置串到下一张
watch(
  () => props.index,
  () => {
    resetTransform()
    showOriginal.value = false
    originalLoading.value = false
    imageError.value = false
  }
)
watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetTransform()
      showOriginal.value = false
      originalLoading.value = false
      imageError.value = false
      pointers.clear()
      dragStart = null
      pinchStartDist = 0
    }
  }
)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  stage.value?.addEventListener?.('wheel', onWheel, { passive: false })
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  stage.value?.removeEventListener?.('wheel', onWheel)
})
</script>

<style scoped>
.civ {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.92);
  color: #fff;
  touch-action: none;
  user-select: none;
}
.civ-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  background: linear-gradient(rgba(0, 0, 0, 0.55), transparent);
}
.civ-counter {
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.92;
}
.civ-counter--plain { opacity: 0.7; }
.civ-topbar-spacer { width: 2.25rem; }
.civ-icon-btn,
.civ-text-btn,
.civ-nav,
.civ-original-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.18s ease, opacity 0.18s ease;
}
.civ-icon-btn:hover,
.civ-text-btn:hover,
.civ-nav:hover,
.civ-original-btn:hover { background: rgba(255, 255, 255, 0.24); }
.civ-icon-btn:focus-visible,
.civ-text-btn:focus-visible,
.civ-nav:focus-visible,
.civ-original-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.civ-icon-btn { width: 2.25rem; height: 2.25rem; flex: 0 0 auto; }
.civ-text-btn {
  padding: 0.45rem 0.9rem;
  font-size: 0.84rem;
}
.civ-text-btn:disabled { opacity: 0.6; cursor: default; }

.civ-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
}
.civ-img {
  max-width: min(94vw, 78rem);
  max-height: 82vh;
  object-fit: contain;
  transition: transform 0.2s ease;
  will-change: transform;
}
.civ-stage.is-dragging .civ-img { transition: none; }
.civ-img.is-zoomed { cursor: grab; }
.civ-loading,
.civ-error {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.9rem;
  border-radius: 0.6rem;
  background: rgba(0, 0, 0, 0.6);
  font-size: 0.85rem;
}

.civ-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  width: 2.75rem;
  height: 2.75rem;
  transform: translateY(-50%);
}
.civ-nav-prev { left: 1rem; }
.civ-nav-next { right: 1rem; }

.civ-bottombar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 1rem 1.4rem;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
}
.civ-original-btn {
  padding: 0.5rem 1.1rem;
  font-size: 0.88rem;
}
.civ-original-btn.is-active { opacity: 0.65; cursor: default; }
.civ-hint { font-size: 0.75rem; opacity: 0.6; text-align: center; }

@media (max-width: 768px) {
  .civ-img { max-width: 100vw; max-height: 76vh; }
  .civ-nav { width: 2.25rem; height: 2.25rem; }
  .civ-nav-prev { left: 0.5rem; }
  .civ-nav-next { right: 0.5rem; }
  .civ-btn-label { display: none; }
  .civ-text-btn { padding: 0.45rem; width: 2.25rem; height: 2.25rem; }
  .civ-topbar-spacer { width: 2.25rem; }
  .civ-bottombar { padding-bottom: max(1.2rem, env(safe-area-inset-bottom)); }
}
@media (max-width: 480px) {
  .civ-hint { display: none; }
}
</style>

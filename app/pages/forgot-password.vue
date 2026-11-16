/* Modified by YH-Chen-Eternity on 2026-10-23 */

<template>
  <div class="auth-layout">
    <div class="auth-main">
      <div class="auth-container">
      <div class="form-section">
        <div class="form-header">
          <h1 class="form-title">{{ locale.title }}</h1>
          <p class="form-subtitle">{{ locale.subtitle }}</p>
          <div class="header-divider" />
        </div>
        
        <div v-if="success" class="success-container">
          <svg class="success-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="success-message">{{ successMessage }}</p>
          <NuxtLink to="/login" class="back-link-btn">{{ locale.backLogin }}</NuxtLink>
        </div>

        <form v-else :class="['auth-form', { 'has-error': !!error }]" @submit.prevent="handleSubmit">
          <div class="form-group" v-if="step === 1">
            <label for="username">{{ locale.username }}</label>
            <div class="input-wrapper">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <input
                id="username"
                v-model="username"
                :class="{ 'input-error': error }"
                :placeholder="locale.usernamePlaceholder"
                required
                type="text"
                @input="error = ''"
              >
            </div>
          </div>

          <div class="form-group" v-if="step === 2">
            <label for="email">{{ locale.verifyEmail }}</label>
            <p class="text-sm text-[var(--text-secondary)] mb-2">
              {{ locale.detectedEmailPrefix }}<strong class="text-[var(--primary)]">{{ maskedEmail }}</strong>
            </p>
            <div class="input-wrapper">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
              <input
                id="email"
                v-model="email"
                :class="{ 'input-error': error }"
                :placeholder="locale.emailPlaceholder"
                required
                type="email"
                @input="error = ''"
              >
            </div>
          </div>

          <div v-if="error" class="error-container">
            <svg class="error-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
            <span class="error-message">{{ error }}</span>
          </div>

          <!-- 第一步验完即签发票据，第二步凭票通行，避免同一个一次性 token 被核销两次 -->
          <TurnstileWidget v-if="showTurnstile && step === 1" ref="turnstileRef" v-model="turnstileToken" />

          <button :disabled="loading" class="submit-btn" type="submit">
            <svg v-if="loading" class="loading-spinner" viewBox="0 0 24 24">
              <circle cx="12" cy="12" fill="none" r="10" stroke="currentColor" stroke-dasharray="31.416" stroke-dashoffset="31.416" stroke-linecap="round" stroke-width="2">
                <animate attributeName="stroke-dasharray" dur="2s" repeatCount="indefinite" values="0 31.416;15.708 15.708;0 31.416"/>
                <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="0;-15.708;-31.416"/>
              </circle>
            </svg>
            <span v-if="loading">{{ step === 1 ? locale.verifying : locale.sending }}</span>
            <span v-else>{{ step === 1 ? locale.nextStep : locale.sendResetEmail }}</span>
          </button>
          
          <div class="form-footer">
            <button v-if="step === 2" type="button" @click="goBack" class="back-link mr-4" style="background: none; border: none; cursor: pointer;">
              {{ locale.previousStep }}
            </button>
            <NuxtLink to="/login" class="back-link">{{ locale.backLogin }}</NuxtLink>
          </div>
        </form>
      </div>
      </div>
    </div>
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import TurnstileWidget from '~/components/Auth/TurnstileWidget.vue'
import { useLocale } from '~/utils/locale'

const { siteTitle, initSiteConfig, captchaEnabled, captchaProvider, turnstileSiteKey } = useSiteConfig()
const { pages } = useLocale()
const locale = computed(() => pages.value?.forgotPassword || {})

const username = ref('')
const email = ref('')
const loading = ref(false)
const error = ref('')
const success = ref(false)
const successMessage = ref('')
const step = ref(1)
const maskedEmail = ref('')
const turnstileToken = ref('')
const resetTicket = ref('')
const waitingCaptcha = ref(false)
const turnstileRef = ref<{ getToken?: () => string; reset?: () => void; isReady?: () => boolean } | null>(null)

const showTurnstile = computed(
  () => captchaEnabled.value && captchaProvider.value === 'turnstile' && !!turnstileSiteKey.value
)

// 服务端错误统一通过错误码本地化，成功文案直接取本地化整句
const { localize: localizeServerError, extractErrorCode } = useServerErrors()

useHead({
  title: () => siteTitle.value ? `${locale.value.title} | ${siteTitle.value}` : locale.value.title
})

onMounted(async () => {
  await initSiteConfig()
})

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 取一个可用的人机验证 token。
 * Cloudflare 校验完成到 callback 触发之间有几百毫秒到几秒的延迟，用户手快时
 * v-model 还是空的，直接把空 token 发出去就会被服务端判成「未完成人机验证」。
 * 这里先主动向控件取，取不到再短轮询等待，避免把空 token 发出去。
 */
async function waitTurnstileToken(maxWaitMs = 8000, intervalMs = 300): Promise<string> {
  if (!showTurnstile.value) return ''

  const read = () => turnstileToken.value || turnstileRef.value?.getToken?.() || ''

  const first = read()
  if (first) return first

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const token = read()
    if (token) return token
  }
  return ''
}

// token 到位后清掉「验证还在进行」这类临时提示，避免控件显示成功、页面还挂着报错；
// 若这次点击因为等超时被挂起，token 一到就自动续跑，用户不用再点一次
watch(turnstileToken, (token) => {
  if (!token) return
  const waiting = locale.value.captchaWaiting
  if (waiting && error.value === waiting) error.value = ''
  if (waitingCaptcha.value && !loading.value && step.value === 1) {
    waitingCaptcha.value = false
    handleSubmit()
  }
})

const handleSubmit = async () => {
  // Turnstile token 一次性，连点会让第二次请求拿到「已核销」而误报失败
  if (loading.value) return
  waitingCaptcha.value = false
  if (step.value === 1) {
    if (!username.value) {
      error.value = locale.value.usernameRequired
      return
    }
  } else if (step.value === 2) {
    if (!email.value) {
      error.value = locale.value.emailRequired
      return
    }
  }

  loading.value = true
  error.value = ''

  try {
    // 只有第一步需要人机验证；第二步凭第一步签发的票据放行
    const token = step.value === 1 ? await waitTurnstileToken() : ''
    if (step.value === 1 && showTurnstile.value && !token) {
      // 等待超时仍未拿到 token：控件已渲染说明只是还没验完，挂起等 token 到了自动续跑；
      // 未渲染则是脚本/网络问题，重置控件并提示刷新
      if (turnstileRef.value?.isReady?.()) {
        waitingCaptcha.value = true
        error.value = locale.value.captchaWaiting || '人机验证还在进行，请稍候再试'
      } else {
        turnstileRef.value?.reset?.()
        error.value = locale.value.captchaFailed || '人机验证加载失败，请刷新页面后重试'
      }
      return
    }

    const body = {
      username: username.value,
      ...(step.value === 2 ? { email: email.value } : {}),
      ...(step.value === 2 && resetTicket.value ? { ticket: resetTicket.value } : {}),
      turnstileToken: token
    }

    const response = await $fetch('/api/auth/forgot-password', {
      method: 'POST',
      body
    })

    if (response.success) {
      if (response.step === 2) {
        // 进入补全邮箱步骤；Turnstile token 已在服务端核销，必须换新
        step.value = 2
        maskedEmail.value = response.maskedEmail || ''
        resetTicket.value = response.ticket || ''
        waitingCaptcha.value = false
        turnstileToken.value = ''
        turnstileRef.value?.reset()
      } else if (response.step === 3) {
        // 成功发送邮件
        success.value = true
        successMessage.value = locale.value.serverMessages?.mailSentFull || locale.value.mailSent
      }
    }
  } catch (err) {
    const code = extractErrorCode(err) || ''
    if (step.value === 2 && (code === 'AUTH_CAPTCHA_REQUIRED' || code === 'AUTH_CAPTCHA_FAILED_OR_EXPIRED')) {
      // 票据过期或失效：回到第一步重新走人机验证，避免卡在没有验证码控件的第二步
      step.value = 1
      resetTicket.value = ''
      maskedEmail.value = ''
    }
    error.value = localizeServerError(err, locale.value.requestFailed)
    turnstileToken.value = ''
    turnstileRef.value?.reset()
  } finally {
    loading.value = false
  }
}
const goBack = () => {
  step.value = 1
  error.value = ''
  resetTicket.value = ''
  maskedEmail.value = ''
  turnstileToken.value = ''
  turnstileRef.value?.reset()
}
</script>

<style scoped>
.auth-layout {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 20px;
}

.auth-main {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding-bottom: clamp(16px, 4vh, 40px);
}

.auth-container {
  width: 100%;
  max-width: 480px;
  background: var(--bg-secondary);
  border-radius: var(--radius-2xl);
  border: 1px solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.form-section {
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
}

.form-header {
  text-align: center;
  margin-bottom: 32px;
}

.form-title {
  font-size: 24px;
  font-weight: var(--font-bold);
  margin: 0 0 8px 0;
  color: var(--text-primary);
}

.form-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

.header-divider {
  height: 1px;
  background: var(--border-secondary);
  margin: 20px auto 0;
  width: 100%;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 14px;
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-wrapper::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 8px;
  height: 2px;
  background: var(--primary);
  border-radius: 2px;
  opacity: 0;
  transform: scaleX(0.2);
  transition: transform var(--transition-normal), opacity var(--transition-normal);
}

.input-wrapper:focus-within::after {
  opacity: 0.35;
  transform: scaleX(1);
}

.input-icon {
  position: absolute;
  left: 16px;
  width: 20px;
  height: 20px;
  color: var(--text-quaternary);
  z-index: 1;
}

.input-wrapper input {
  width: 100%;
  padding: 16px 16px 16px 48px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-lg);
  color: var(--input-text);
  font-size: 16px;
  transition: border-color var(--transition-normal), box-shadow var(--transition-normal);
}

.input-wrapper input::placeholder {
  color: var(--input-placeholder);
}

.input-wrapper input:focus {
  outline: none;
  border-color: var(--input-border-focus);
  box-shadow: var(--input-shadow-focus);
}

.input-wrapper input:focus + .input-icon,
.input-wrapper input:not(:placeholder-shown) + .input-icon {
  color: var(--primary);
}

.input-wrapper input.input-error {
  border-color: var(--error);
  box-shadow: 0 0 0 3px var(--error-light);
}

.error-container {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--error-light);
  border: 1px solid var(--error-border);
  border-radius: var(--radius-lg);
  color: var(--error);
}

.auth-form.has-error {
  animation: shake 0.4s ease;
}

@keyframes shake {
  0% { transform: translateX(0); }
  15% { transform: translateX(-6px); }
  30% { transform: translateX(6px); }
  45% { transform: translateX(-4px); }
  60% { transform: translateX(4px); }
  75% { transform: translateX(-2px); }
  90% { transform: translateX(2px); }
  100% { transform: translateX(0); }
}

.error-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.error-message {
  font-size: 14px;
  font-weight: var(--font-medium);
}

.submit-btn {
  width: 100%;
  padding: 16px;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border: 1px solid var(--btn-primary-border);
  border-radius: var(--radius-lg);
  font-size: 16px;
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: background var(--transition-normal), box-shadow var(--transition-normal), transform var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.submit-btn:hover:not(:disabled) {
  background: var(--btn-primary-hover);
  box-shadow: var(--shadow-lg);
  transform: translateY(-1px);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.loading-spinner {
  width: 20px;
  height: 20px;
}

.form-footer {
  margin-top: 16px;
  text-align: center;
}

.back-link {
  font-size: 14px;
  color: var(--primary);
  text-decoration: none;
  transition: opacity 0.2s ease;
}

.back-link:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.success-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 20px 0;
  width: 100%;
}

.success-icon {
  width: 64px;
  height: 64px;
  color: var(--success);
  margin-bottom: 20px;
}

.success-message {
  font-size: 16px;
  color: var(--text-primary);
  margin-bottom: 32px;
  line-height: 1.5;
}

.back-link-btn {
  padding: 12px 32px;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border-radius: var(--radius-lg);
  text-decoration: none;
  font-weight: var(--font-medium);
  transition: opacity 0.2s ease;
}

.back-link-btn:hover {
  opacity: 0.9;
}

@media (max-width: 768px) {
  .auth-layout {
    padding: 10px;
  }
  .auth-container {
    border-radius: 16px;
  }
  .form-section {
    padding: 30px 20px;
  }
}
</style>

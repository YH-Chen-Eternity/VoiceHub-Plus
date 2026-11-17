import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, ref } from 'vue'

const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const root = new URL('../../', import.meta.url)

const source = readFileSync(new URL('app/components/Auth/LoginForm.vue', root), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'auth-legal-consent' })
const declarations = script.scriptSetupAst.flatMap((node: any) => node.declarations || [])

const CONSENT_NAMES = ['legalConsentActive', 'loginTermsBlocked', 'legalConsentEntryBlocked']

/** 隔离求值条款拦截相关的 computed，避免拉起整个登录组件的依赖 */
function setup(displayMode: string, { enabled = true, accepted = false, isBindMode = false } = {}) {
  const context = vm.createContext({
    computed,
    legalConsentEnabled: ref(enabled),
    legalConsentDisplayMode: ref(displayMode),
    legalConsentDocuments: ref(enabled ? [{ name: '服务条款', slug: 'terms' }] : []),
    isBindMode: ref(isBindMode),
    showCreateMode: ref(false),
    loginTermsAccepted: ref(accepted)
  })
  for (const name of CONSENT_NAMES) {
    const declaration = declarations.find((item: any) => item.id.name === name)
    assert.ok(declaration, `LoginForm.vue 缺少 computed: ${name}`)
    const code = descriptor.scriptSetup.content.slice(declaration.init.start, declaration.init.end)
    new vm.Script(`var ${name} = (${code})`).runInContext(context)
  }
  return context
}

test('弹窗模式下条款未确认不拦截认证入口（发码按钮死锁）', () => {
  const modal = setup('modal')
  assert.equal(modal.loginTermsBlocked.value, true, '弹窗模式下条款仍未确认')
  assert.equal(modal.legalConsentEntryBlocked.value, false, '弹窗模式入口不应禁用，否则发码按钮无法点击')
})

test('复选框模式下条款未确认仍拦截全部认证入口', () => {
  assert.equal(setup('checkbox').legalConsentEntryBlocked.value, true)
  assert.equal(setup('checkbox', { accepted: true }).legalConsentEntryBlocked.value, false)
})

test('条款确认未开启或第三方绑定登录不拦截入口', () => {
  assert.equal(setup('checkbox', { enabled: false }).legalConsentEntryBlocked.value, false)
  assert.equal(setup('checkbox', { isBindMode: true }).legalConsentEntryBlocked.value, false)
})

test('发码按钮复用统一的条款拦截条件，模板内不重复内联', () => {
  const template = descriptor.template.content
  assert.equal(/loginTermsBlocked/.test(template), false, '模板应统一引用 legalConsentEntryBlocked')

  // 社区版发码按钮无固定 id，按 @click="sendEmailCode" 定位。
  // 注意 :disabled 的值里含 `codeCountdown > 0`（有 `>`），不能用 [^>]* 截断标签，
  // 改为从 <button 截到 @click 出现处，属性值都在引号内，可安全提取 :disabled。
  const clickAt = template.indexOf('@click="sendEmailCode"')
  assert.ok(clickAt !== -1, '未找到发码按钮')
  const openAt = template.lastIndexOf('<button', clickAt)
  const tagSlice = template.slice(openAt, clickAt + '@click="sendEmailCode"'.length)
  const codeButtonDisabled = /:disabled="([^"]+)"/.exec(tagSlice)?.[1] || ''
  assert.match(codeButtonDisabled, /legalConsentEntryBlocked/, '发码按钮需受统一条款拦截约束')
})

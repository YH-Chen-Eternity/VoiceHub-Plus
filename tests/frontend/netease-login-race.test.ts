import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from 'vue/compiler-sfc'

/**
 * 扫码登录弹窗的竞态回归测试。
 *
 * 覆盖三类真实缺陷（对应上游 1953b0f 的修复方向，以及我们额外发现的 v-if 挂载问题）：
 * 1. 初始化失败时 catch 里再次 stopPolling，会让 finally 的 loading 复位失效，弹窗永久转圈；
 * 2. await res.json() 期间弹窗被关闭/重开，迟到的 unikey / 二维码会覆盖新一轮状态；
 * 3. 父组件用 v-if="show" 挂载时，非 immediate 的 watch 不会初始化，弹窗空白。
 */

const component = readFileSync(
  new URL('../../app/components/Songs/NeteaseLoginModal.vue', import.meta.url),
  'utf8'
)
const scheduleList = readFileSync(
  new URL('../../app/components/Songs/ScheduleList.vue', import.meta.url),
  'utf8'
)
const { descriptor } = parse(component, { filename: 'NeteaseLoginModal.vue' })
const script = descriptor.scriptSetup!.content

const state = (() => {
  const start = script.indexOf('const BASE_URL =')
  const end = script.indexOf('const handleLoginSuccess')
  assert.ok(start >= 0 && end > start, '无法定位登录弹窗的脚本片段')
  // vm 直接执行源码，去掉 TS 专属的类型注解（定时器句柄的写法可能调整，按行归一）
  return script
    .slice(start, end)
    .replace(/^let (timer|retryTimer): [^=]+= null$/gm, 'let $1 = null')
})()

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

const response = (body: unknown) => ({ ok: true, json: async () => body })

const createHarness = () => {
  const pending: Array<Deferred<unknown>> = []
  const intervals = new Map<number, () => void>()
  const timeouts = new Map<number, () => void>()
  let nextTimer = 0

  const sandbox: Record<string, unknown> = {
    ref: (value: unknown) => ({ value }),
    fetch: () => {
      const request = deferred<unknown>()
      pending.push(request)
      return request.promise
    },
    props: { show: true },
    emit: () => {},
    handleLoginSuccess: async () => {},
    BASE_URL: '/api/api-enhanced/netease',
    console: { error() {}, warn() {}, log() {} },
    setInterval: (callback: () => void) => {
      const id = ++nextTimer
      intervals.set(id, callback)
      return id
    },
    clearInterval: (id: number) => {
      intervals.delete(id)
    },
    setTimeout: (callback: () => void) => {
      const id = ++nextTimer
      timeouts.set(id, callback)
      return id
    },
    clearTimeout: (id: number) => {
      timeouts.delete(id)
    }
  }

  const api = runInNewContext(
    `${state}\n({
      initLogin, checkStatus, stopPolling,
      getUnikey: () => unikey,
      getSession: () => session,
      qrImg, loading, status, isExpired
    })`,
    sandbox
  ) as {
    initLogin: () => Promise<void>
    checkStatus: (retry?: number, currentSession?: number) => Promise<void>
    stopPolling: () => void
    getUnikey: () => string
    getSession: () => number
    qrImg: { value: string }
    loading: { value: boolean }
    status: { value: number }
    isExpired: { value: boolean }
  }

  return { api, pending, intervals, timeouts, props: sandbox.props as { show: boolean } }
}

test('初始化失败时 loading 必须复位，弹窗不能永久停在加载态', async () => {
  const { api, pending } = createHarness()
  const opening = api.initLogin()
  assert.equal(api.loading.value, true)

  pending[0].reject(new Error('network down'))
  await opening

  assert.equal(api.loading.value, false, '失败后 loading 仍为 true，用户会看到永久转圈')
  assert.equal(api.status.value, 0)
})

test('关闭弹窗后迟到的 key 响应不得覆盖 unikey，也不得继续发起 create', async () => {
  const { api, pending } = createHarness()
  const opening = api.initLogin()
  assert.equal(pending.length, 1)

  // 真实的竞态窗口是「fetch 校验已通过、响应体解析还没完成」：
  // 先让 fetch 返回，但把 json() 挂起，此时再关闭弹窗
  const jsonGate = deferred<unknown>()
  pending[0].resolve({ ok: true, json: () => jsonGate.promise })
  await flush()

  api.stopPolling()
  jsonGate.resolve({ data: { unikey: 'STALE-KEY' } })
  await opening

  assert.equal(api.getUnikey(), '', '迟到的 unikey 污染了全局状态')
  assert.equal(pending.length, 1, '过期会话不应继续请求 create')
})

test('关闭弹窗后迟到的二维码响应不得覆盖新二维码，也不得启动轮询', async () => {
  const { api, pending, intervals } = createHarness()
  const opening = api.initLogin()
  pending[0].resolve(response({ data: { unikey: 'KEY-1' } }))
  await flush()
  assert.equal(pending.length, 2, '应当继续发起 create')

  // create 的响应体解析同样挂起，期间关闭弹窗
  const jsonGate = deferred<unknown>()
  pending[1].resolve({ ok: true, json: () => jsonGate.promise })
  await flush()

  api.stopPolling()
  jsonGate.resolve({ data: { qrimg: 'data:image/png;base64,STALE' } })
  await opening

  assert.equal(intervals.size, 0, '过期会话不应启动轮询定时器')
  assert.notEqual(api.qrImg.value, 'data:image/png;base64,STALE', '迟到的二维码覆盖了当前状态')
  assert.equal(api.getUnikey(), 'KEY-1')
})

test('initLogin 的错误分支不再调用 stopPolling', () => {
  const start = script.indexOf("console.error('初始化登录失败:', err)")
  const end = script.indexOf('} finally {', start)
  assert.ok(start >= 0 && end > start)
  // 去掉注释行，避免把说明文字里的 stopPolling() 当成真实调用
  const segment = script
    .slice(start, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.doesNotMatch(segment, /stopPolling\(\)/)
})

test('watch 带 immediate，v-if 挂载的弹窗也能初始化', () => {
  assert.match(script, /watch\(\s*\(\) => props\.show,[\s\S]*?\{\s*immediate:\s*true\s*\}\s*\)/)
  assert.doesNotMatch(
    scheduleList,
    /<NeteaseLoginModal\s+v-if=/,
    'ScheduleList 不应再用 v-if 与 :show 同绑，否则会重复挂载并丢失关闭动画'
  )
})

test('803 之后的登录态查询失败时不再写入空用户信息', () => {
  const handler = script.slice(script.indexOf('const handleLoginSuccess'))
  assert.match(handler, /if \(!userRes\.ok \|\| !profile\?\.userId\) throw/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

/**
 * 运行真实的网易云代理路由：证明
 * - 所有接口都把访客真实 IP 作为出口 IP，客户端传入的 realIP 一律丢弃；
 * - 拿不到访客地址（内部调用、私网/回环）时不注入 realIP，也不做任何回退；
 * - NETEASE_REAL_IP_MODE=off 时完全不下发 realIP；
 * - 803 响应丢失后可按 unikey 补发，且只回放给领取该二维码的客户端、只在 10s 窗口内。
 */

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const rootDir = resolve('../../')
const routeSource = resolve('../../server/api/api-enhanced/netease/[...path].ts')
const utilSource = resolve('../../server/utils/neteaseRealIp.ts')

// 生产由 Nginx 覆写 x-real-ip 并在 .env 里声明受信头；这里用同样的配置模拟
process.env.TRUSTED_CLIENT_IP_HEADERS = 'x-real-ip'

const modules: Record<string, string> = {
  h3: 'export const getHeaders = (event) => event?.node?.req?.headers || {}',
  '@neteasecloudmusicapienhanced/api': `
    const calls = globalThis.__ncmCalls
    export const login_qr_key = params => { calls.push({ endpoint: 'login/qr/key', params }); return { body: { code: 200 } } }
    export const login_qr_create = params => { calls.push({ endpoint: 'login/qr/create', params }); return { body: { code: 200 } } }
    export const login_qr_check = params => { calls.push({ endpoint: 'login/qr/check', params }); return globalThis.__ncmQrCheck || { body: { code: 800 } } }
    export const login_status = params => { calls.push({ endpoint: 'login/status', params }); return { body: { code: 200 } } }
    export const song_url_v1 = params => { calls.push({ endpoint: 'song/url/v1', params }); return { body: { code: 200 } } }
    export default { login_qr_key, login_qr_create, login_qr_check, login_status, song_url_v1 }
  `,
  '@neteasecloudmusicapienhanced/api/generateConfig.js': `export default async () => {}`
}

Object.assign(globalThis as any, { __ncmCalls: [] })

// Nitro 自动导入的 h3 运行时钩子在这里手工提供
Object.assign(globalThis as any, {
  defineEventHandler: (fn: unknown) => fn,
  getRouterParam: (event: any, name: string) => event.params?.[name],
  getMethod: (event: any) => event.method || 'GET',
  getQuery: (event: any) => event.query || {},
  readBody: async (event: any) => event.body || {},
  setHeader: (event: any, name: string, value: unknown) => {
    ;(event.headers ||= {})[name] = value
  },
  // appendHeader 与 setHeader 的差异是保留已有值，owner cookie 依赖这一点
  appendHeader: (event: any, name: string, value: unknown) => {
    ;(event.headers ||= {})
    const current = event.headers[name]
    const list = current === undefined ? [] : Array.isArray(current) ? current : [current]
    event.headers[name] = [...list, value]
  },
  setResponseStatus: (event: any, status: number) => {
    event.status = status
  },
  createError: (options: any) => Object.assign(new Error(options.message), options)
})

const compiled = await build({
  // 用虚拟入口导出路由，避免测试另建一份表达式副本
  stdin: {
    contents: `export { default } from ${JSON.stringify(routeSource)}`,
    resolveDir: rootDir,
    sourcefile: 'netease-route-test-entry.ts',
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  // 让测试自包含：不依赖 nuxt prepare 生成的 .nuxt/tsconfig.json 别名映射
  alias: {
    '~~/server/config/constants': resolve('../../server/config/constants.ts'),
    '~~/server/utils/serverTime': resolve('../../server/utils/serverTime.ts'),
    '~~/server/utils/neteaseRealIp': utilSource,
    '~~/server/utils/ip-utils': resolve('../../server/utils/ip-utils.ts'),
    '~~/server/utils/redis': resolve('../fixtures/qr-redis-stub.ts')
  },
  plugins: [{
    name: 'resolve-fixture',
    setup(b) {
      b.onResolve({ filter: /^(h3|@neteasecloudmusicapienhanced\/)/ }, (args) => ({
        path: args.path,
        namespace: 'fixture'
      }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
        contents: modules[args.path] || 'export default {}',
        loader: 'ts'
      }))
    }
  }]
})

const bundle = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
)
const handler = bundle.default

interface EventOptions {
  /** 传 null 表示不带 x-real-ip，模拟非代理来源 */
  ip?: string | null
  socketIp?: string
  cookie?: string
}

function makeEvent(
  pathname: string,
  query: Record<string, any> = {},
  options: EventOptions = {}
): any {
  const headers: Record<string, string> = {}
  if (options.ip !== null) headers['x-real-ip'] = options.ip ?? '113.108.1.10'
  if (options.cookie) headers.cookie = options.cookie
  const req: any = { headers }
  if (options.socketIp) req.socket = { remoteAddress: options.socketIp }
  return {
    params: { path: pathname },
    method: 'GET',
    query: { ...query },
    node: { req },
    headers: {} as Record<string, unknown>
  }
}

/** 从响应头里取出补发用的发起方标识 */
function readOwner(event: any): string {
  const raw = event.headers?.['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  for (const item of list) {
    const matched = String(item).match(/vh_qr_owner=([0-9a-f]+)/)
    if (matched) return matched[1]!
  }
  return ''
}

async function call(
  pathname: string,
  query: Record<string, any> = {},
  ip: string | null = '113.108.1.10'
) {
  await handler(makeEvent(pathname, query, { ip }))
  const callRecord = (globalThis as any).__ncmCalls.at(-1)
  assert.equal(callRecord.endpoint, pathname)
  return callRecord.params as Record<string, any>
}

/** 需要读取响应体时使用（补发逻辑只体现在返回值上） */
function respond(pathname: string, query: Record<string, any> = {}, options: EventOptions = {}) {
  return handler(makeEvent(pathname, query, options))
}

/** 领一个二维码并返回本次的发起方标识 */
async function openQr(): Promise<string> {
  const event = makeEvent('login/qr/key')
  await handler(event)
  const owner = readOwner(event)
  assert.ok(owner, 'qr/key 应下发发起方标识')
  return owner
}

test('所有接口都把访客真实 IP 作为出口 IP', async () => {
  for (const endpoint of ['login/qr/key', 'login/status', 'song/url/v1']) {
    const params = await call(endpoint, {}, '113.108.1.10')
    assert.equal(params.realIP, '113.108.1.10', `${endpoint} 未使用访客 IP`)
  }
})

test('客户端传入的 realIP 一律丢弃', async () => {
  for (const endpoint of ['login/qr/key', 'login/status']) {
    const params = await call(endpoint, { realIP: '1.2.3.4' }, '5.6.7.8')
    assert.equal(params.realIP, '5.6.7.8')
    assert.notEqual(params.realIP, '1.2.3.4')
  }
})

test('同一次扫码的 key / create / check 使用同一出口 IP', async () => {
  const ip = '113.108.1.10'
  const keyed = await call('login/qr/key', {}, ip)
  const created = await call('login/qr/create', { key: 'unikey-1234567890' }, ip)
  const checked = await call('login/qr/check', { key: 'unikey-1234567890' }, ip)
  assert.equal(created.realIP, ip)
  assert.equal(checked.realIP, ip)
  assert.equal(keyed.realIP, ip)
})

test('不同访客使用各自的出口 IP', async () => {
  const first = await call('login/qr/create', { key: 'key-a' }, '113.108.1.10')
  const second = await call('login/qr/create', { key: 'key-a' }, '119.145.2.20')
  assert.equal(first.realIP, '113.108.1.10')
  assert.equal(second.realIP, '119.145.2.20')
})

test('IPv6 访客原样透传', async () => {
  const ip = '240e:3b0:1234::1'
  const keyed = await call('login/qr/key', {}, ip)
  const created = await call('login/qr/create', { key: 'k-ipv6' }, ip)
  assert.equal(keyed.realIP, ip)
  assert.equal(created.realIP, ip)
})

test('非规范 IPv6 写法归一为 RFC 5952 规范形后再透传', async () => {
  const params = await call('login/qr/key', {}, '2001:0DB8:0:0:0:0:0:1')
  assert.equal(params.realIP, '2001:db8::1')
})

test('非规范 IPv6 回环 / 链路本地 / 唯一本地写法同样不注入', async () => {
  for (const ip of ['0:0:0:0:0:0:0:1', 'FE80:0:0:0:0:0:0:1', 'fc00:0:0:0:0:0:0:1']) {
    const params = await call('login/qr/key', {}, ip)
    assert.equal(params.realIP, undefined, `${ip} 不应产生 realIP`)
  }
})

test('IPv6 作用域 ID 在透传前剥离', async () => {
  const params = await call('login/qr/key', {}, '240e:3b0:1234::1%eth0')
  assert.equal(params.realIP, '240e:3b0:1234::1')
})

test('IPv4-mapped IPv6 还原为点分后参与私网判定', async () => {
  const loopback = await call('login/qr/key', {}, '::ffff:7f00:1')
  assert.equal(loopback.realIP, undefined, '::ffff:7f00:1 即 127.0.0.1，不应注入')

  const publicMapped = await call('login/qr/key', {}, '::ffff:113.108.1.10')
  assert.equal(publicMapped.realIP, '113.108.1.10')
})

test('拿不到访客地址时不注入 realIP，且不做任何回退', async () => {
  const keyed = await call('login/qr/key', {}, null)
  const created = await call('login/qr/create', { key: 'k-nofallback' }, null)
  const checked = await call('login/qr/check', { key: 'k-nofallback' }, null)
  assert.equal(keyed.realIP, undefined, `realIP=${keyed.realIP} 不应回退生成`)
  assert.equal(created.realIP, undefined)
  assert.equal(checked.realIP, undefined)
})

test('私网来源（容器内直连）同样不注入 realIP', async () => {
  const event = makeEvent('login/status', {}, { ip: null, socketIp: '172.17.0.1' })
  await handler(event)
  const params = (globalThis as any).__ncmCalls.at(-1).params
  assert.equal(params.realIP, undefined, `realIP=${params.realIP} 不应由私网地址派生`)
})

test('NETEASE_REAL_IP_MODE=off 时不下发 realIP', async () => {
  const original = process.env.NETEASE_REAL_IP_MODE
  process.env.NETEASE_REAL_IP_MODE = 'off'
  try {
    const params = await call('login/qr/key', { realIP: '1.2.3.4' })
    assert.equal(params.realIP, undefined)
  } finally {
    if (original === undefined) delete process.env.NETEASE_REAL_IP_MODE
    else process.env.NETEASE_REAL_IP_MODE = original
  }
})

test('已有发起方标识时不重复下发', async () => {
  const owner = await openQr()
  const again = makeEvent('login/qr/key', {}, { cookie: `vh_qr_owner=${owner}` })
  await handler(again)
  assert.equal(readOwner(again), '')
})

test('803 响应丢失后，同一客户端重复查询可补发登录结果', async () => {
  const g = globalThis as any
  const owner = await openQr()
  const options = { cookie: `vh_qr_owner=${owner}` }

  g.__ncmQrCheck = { body: { code: 803, cookie: 'MUSIC_U=xyz; __csrf=1' } }
  const success = await respond('login/qr/check', { key: 'replay-key' }, options)
  assert.equal(success.code, 803)

  // 网易云侧 unikey 已消费，后续只返回过期；补发保证前端仍能拿到 cookie
  g.__ncmQrCheck = { body: { code: 800, message: '二维码已过期' } }
  const replay = await respond('login/qr/check', { key: 'replay-key' }, options)
  assert.equal(replay.code, 803)
  assert.equal(replay.cookie, 'MUSIC_U=xyz; __csrf=1')

  // 其它二维码不受影响
  const other = await respond('login/qr/check', { key: 'other-key' }, options)
  assert.equal(other.code, 800)
  delete g.__ncmQrCheck
})

test('并发重试不会因为首次补发而丢失结果', async () => {
  const g = globalThis as any
  const owner = await openQr()
  const options = { cookie: `vh_qr_owner=${owner}` }

  g.__ncmQrCheck = { body: { code: 803, cookie: 'MUSIC_U=concurrent' } }
  await respond('login/qr/check', { key: 'concurrent-key' }, options)

  // unikey 已被网易云消费，并发到达的几次查询都要拿到同一份 cookie
  g.__ncmQrCheck = { body: { code: 800 } }
  const results = await Promise.all([
    respond('login/qr/check', { key: 'concurrent-key' }, options),
    respond('login/qr/check', { key: 'concurrent-key' }, options),
    respond('login/qr/check', { key: 'concurrent-key' }, options)
  ])
  for (const item of results) {
    assert.equal(item.code, 803)
    assert.equal(item.cookie, 'MUSIC_U=concurrent')
  }
  delete g.__ncmQrCheck
})

test('补发窗口内的 803 结果仍可回放（正常补发不受影响）', async () => {
  const g = globalThis as any
  const owner = await openQr()
  const options = { cookie: `vh_qr_owner=${owner}` }

  g.__ncmQrCheck = { body: { code: 803, cookie: 'MUSIC_U=window-ok' } }
  await respond('login/qr/check', { key: 'window-ok-key' }, options)

  const realNow = Date.now
  try {
    // 9 秒：仍在 10 秒补发窗口内，模拟前端第二次补查
    Date.now = () => realNow() + 9_000
    g.__ncmQrCheck = { body: { code: 800 } }
    const replay = await respond('login/qr/check', { key: 'window-ok-key' }, options)
    assert.equal(replay.code, 803)
    assert.equal(replay.cookie, 'MUSIC_U=window-ok')
  } finally {
    Date.now = realNow
    delete g.__ncmQrCheck
  }
})

test('超过补发窗口的 803 结果不再回放，避免一次性凭证长时间可兑换', async () => {
  const g = globalThis as any
  const owner = await openQr()
  const options = { cookie: `vh_qr_owner=${owner}` }

  g.__ncmQrCheck = { body: { code: 803, cookie: 'MUSIC_U=window-test' } }
  const success = await respond('login/qr/check', { key: 'window-key' }, options)
  assert.equal(success.code, 803)

  const realNow = Date.now
  try {
    // 11 秒后：缓存本身还没到 5 分钟 TTL，但已超出 10 秒补发窗口
    Date.now = () => realNow() + 11_000
    g.__ncmQrCheck = { body: { code: 800, message: '二维码已过期' } }
    const replay = await respond('login/qr/check', { key: 'window-key' }, options)
    assert.equal(replay.code, 800, '超出补发窗口后不应再返回 803')
    assert.equal(replay.cookie, undefined, '超出补发窗口后不应再回放 cookie')
  } finally {
    Date.now = realNow
    delete g.__ncmQrCheck
  }
})

test('未领取该二维码的客户端拿不到补发的 cookie', async () => {
  const g = globalThis as any
  const owner = await openQr()
  g.__ncmQrCheck = { body: { code: 803, cookie: 'MUSIC_U=secret' } }
  await respond('login/qr/check', { key: 'stolen-key' }, { cookie: `vh_qr_owner=${owner}` })

  // 换一个发起方标识（unikey 泄露给第三方），不应回放
  g.__ncmQrCheck = { body: { code: 800 } }
  const other = await respond('login/qr/check', { key: 'stolen-key' }, { cookie: 'vh_qr_owner=ffffffff' })
  assert.equal(other.code, 800)
  assert.equal(other.cookie, undefined)
  delete g.__ncmQrCheck
})

test('没有发起方标识的客户端既不缓存也不回放', async () => {
  const g = globalThis as any
  g.__ncmQrCheck = { body: { code: 803, cookie: 'MUSIC_U=noowner' } }
  await respond('login/qr/check', { key: 'no-owner-key' })

  g.__ncmQrCheck = { body: { code: 800 } }
  const again = await respond('login/qr/check', { key: 'no-owner-key' })
  assert.equal(again.code, 800)
  delete g.__ncmQrCheck
})

test('畸形 IP 头不会被当作访客地址，也不回退', async () => {
  const params = await call('login/qr/key', {}, 'not-an-ip<script>')
  assert.equal(params.realIP, undefined)
})

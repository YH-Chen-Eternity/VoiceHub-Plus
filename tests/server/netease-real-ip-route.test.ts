import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { isGuangdongIp } from '../../server/utils/neteaseRealIp.ts'

/**
 * 运行真实的网易云代理路由：证明境外部署场景下
 * - 所有请求都注入广东 realIP，客户端传入的 realIP 被忽略；
 * - 同一次扫码的 key/create/check 使用同一出口 IP；
 * - 同一账号（MUSIC_U）使用同一出口 IP；
 * - NETEASE_REAL_IP_MODE=off 时完全不下发 realIP。
 */

const source = fileURLToPath(new URL('../../server/api/api-enhanced/netease/[...path].ts', import.meta.url))

const modules: Record<string, string> = {
  '@neteasecloudmusicapienhanced/api': `
    const calls = globalThis.__ncmCalls
    export const login_qr_key = params => { calls.push({ endpoint: 'login/qr/key', params }); return { body: { code: 200 } } }
    export const login_qr_create = params => { calls.push({ endpoint: 'login/qr/create', params }); return { body: { code: 200 } } }
    export const login_qr_check = params => { calls.push({ endpoint: 'login/qr/check', params }); return { body: { code: 800 } } }
    export const login_status = params => { calls.push({ endpoint: 'login/status', params }); return { body: { code: 200 } } }
    export default { login_qr_key, login_qr_create, login_qr_check, login_status }
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
  setResponseStatus: (event: any, status: number) => {
    event.status = status
  },
  createError: (options: any) => Object.assign(new Error(options.message), options)
})

const compiled = await build({
  entryPoints: [source],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
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

const { default: handler } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
)

async function call(pathname: string, query: Record<string, any> = {}) {
  const event: any = { params: { path: pathname }, method: 'GET', query: { ...query } }
  await handler(event)
  const callRecord = (globalThis as any).__ncmCalls.at(-1)
  assert.equal(callRecord.endpoint, pathname)
  return callRecord.params as Record<string, any>
}

test('扫码登录请求注入广东 realIP', async () => {
  const params = await call('login/qr/key')
  assert.ok(isGuangdongIp(String(params.realIP)), `realIP=${params.realIP} 不在广东网段`)
})

test('客户端传入的 realIP 被忽略', async () => {
  const params = await call('login/qr/key', { realIP: '1.2.3.4', ip: '5.6.7.8' })
  assert.ok(isGuangdongIp(String(params.realIP)))
  assert.notEqual(params.realIP, '1.2.3.4')
})

test('同一次扫码的 create / check 使用同一 IP', async () => {
  const key = 'unikey-1234567890'
  const created = await call('login/qr/create', { key })
  const checked = await call('login/qr/check', { key })
  assert.equal(created.realIP, checked.realIP)
  assert.ok(isGuangdongIp(String(created.realIP)))
})

test('不同扫码 key 可能落在不同 IP', async () => {
  const first = await call('login/qr/create', { key: 'key-a' })
  const second = await call('login/qr/create', { key: 'key-b' })
  assert.notEqual(first.realIP, second.realIP)
})

test('key 以数组重复传参时 seed 仍与单值一致', async () => {
  const single = await call('login/qr/create', { key: 'unikey-array' })
  const created = await call('login/qr/create', { key: ['stale-key', 'unikey-array'] })
  const checked = await call('login/qr/check', { key: ['stale-key', 'unikey-array'] })
  assert.equal(created.realIP, single.realIP)
  assert.equal(checked.realIP, single.realIP)
})

test('同一账号的 cookie 请求使用同一 IP', async () => {
  const cookie = 'MUSIC_U=abc123; __csrf=def'
  const first = await call('login/status', { cookie })
  const second = await call('login/status', { cookie })
  assert.equal(first.realIP, second.realIP)
  assert.ok(isGuangdongIp(String(first.realIP)))
})

test('cookie 以数组重复传参时仍能识别 MUSIC_U', async () => {
  const single = await call('login/status', { cookie: 'MUSIC_U=abc123; __csrf=def' })
  const arrayForm = await call('login/status', { cookie: ['MUSIC_U=abc123', '__csrf=def'] })
  assert.equal(arrayForm.realIP, single.realIP)
})

test('NETEASE_REAL_IP_MODE=off 时不下发 realIP', async () => {
  const original = process.env.NETEASE_REAL_IP_MODE
  process.env.NETEASE_REAL_IP_MODE = 'off'
  try {
    const params = await call('login/qr/key')
    assert.equal(params.realIP, undefined)
  } finally {
    if (original === undefined) delete process.env.NETEASE_REAL_IP_MODE
    else process.env.NETEASE_REAL_IP_MODE = original
  }
})

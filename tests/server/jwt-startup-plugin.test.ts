import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

/**
 * V-01 启动期回归：Nitro 插件必须在进程启动、尚未对外监听时完成密钥校验。
 *
 * 这里把 `server/plugins/00.jwt-secret.ts` 连同 `~~/` 别名一起打包，用
 * `defineNitroPlugin(fn) => fn()` 模拟 Nitro 注册即执行，断言弱密钥在
 * **模块加载阶段**就抛错——而不是等到首个认证请求（路由 chunk 懒加载）才校验。
 */

const VALID_SECRET = 'K7mQ2xR9tL4vN8bW1cZ6yH3jF5dS0gAe'
process.env.JWT_SECRET = VALID_SECRET

const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL('../../server/plugins/00.jwt-secret.ts', import.meta.url))
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: {
    '~~/server/utils/jwt-enhanced': fileURLToPath(
      new URL('../../server/utils/jwt-enhanced.ts', import.meta.url)
    ),
    jsonwebtoken: fileURLToPath(new URL('../fixtures/jwt-stub.ts', import.meta.url))
  }
})

const moduleUrl = `data:text/javascript;base64,${Buffer.from(
  compiled.outputFiles[0].contents
).toString('base64')}`

const loadPlugin = async (secret?: string) => {
  const previous = process.env.JWT_SECRET
  if (secret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = secret

  // 模拟 Nitro：注册回调即执行，等价于启动阶段跑一遍校验
  ;(globalThis as { defineNitroPlugin?: (fn: () => unknown) => unknown }).defineNitroPlugin = (
    fn
  ) => {
    fn()
    return { name: '00.jwt-secret' }
  }

  try {
    // 每次换一个 hash，避免 ESM 模块缓存导致第二次加载跳过求值
    return await import(`${moduleUrl}#${Math.random()}`)
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previous
  }
}

test('插件在启动阶段拒绝未配置的 JWT_SECRET', async () => {
  await assert.rejects(() => loadPlugin(undefined), /JWT_SECRET environment variable is not set/)
})

test('插件在启动阶段拒绝示例弱口令，不等首个认证请求', async () => {
  await assert.rejects(
    () => loadPlugin('your-very-secure-jwt-secret-key-1234'),
    /示例\/弱口令/
  )
})

test('插件在启动阶段拒绝低熵密钥', async () => {
  await assert.rejects(() => loadPlugin('a'.repeat(64)), /熵过低/)
})

test('高熵密钥通过，插件正常导出', async () => {
  const mod = await loadPlugin(VALID_SECRET)
  assert.deepEqual((mod as { default?: unknown }).default, { name: '00.jwt-secret' })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

/**
 * V-01 回归：认证中间件不能再让持有签名令牌的请求"自证"登录态。
 *
 * 原实现检查不到 jti 时会拿令牌自带字段插一条 loginMethod='legacy' 的会话，
 * 等于服务端从不校验令牌是否由自己签发过。现在只认 createAuthSession 写入的记录。
 */

process.env.JWT_SECRET = 'K7mQ2xR9tL4vN8bW1cZ6yH3jF5dS0gAe'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))
const source = fileURLToPath(new URL('../../server/utils/auth-session.ts', import.meta.url))

// 只替换数据访问层：查询结果由测试逐条注入，insert 一旦被调用即判失败
const dbStub = {
  name: 'drizzle-db-stub',
  setup(pluginBuild: any) {
    pluginBuild.onResolve({ filter: /^~\/drizzle\/db$/ }, () => ({
      path: 'db',
      namespace: 'db-stub'
    }))
    pluginBuild.onLoad({ filter: /.*/, namespace: 'db-stub' }, () => ({
      contents: `
        export const authSessions = { id: 'id', userId: 'userId' }
        export const eq = (column, value) => ({ column, value })
        export const db = {
          query: { authSessions: { findFirst: async () => globalThis.__sessionRow ?? null } },
          insert: () => {
            globalThis.__insertCalls = (globalThis.__insertCalls || 0) + 1
            throw new Error('不应再为未知 jti 自动补建会话')
          }
        }
      `,
      loader: 'js'
    }))
  }
}

const compiled = await build({
  stdin: {
    contents: `export { ensureAuthSession } from ${JSON.stringify(source)}`,
    resolveDir: rootDir,
    sourcefile: 'auth-session-test-entry.ts',
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  tsconfig: fileURLToPath(new URL('../../.nuxt/tsconfig.json', import.meta.url)),
  // 打包成 data: URL 后没有真实的 import.meta.url，CJS 依赖（jsonwebtoken 等）需要显式 require
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(
      fileURLToPath(new URL('../../package.json', import.meta.url))
    )});`
  },
  plugins: [dbStub]
})

const { ensureAuthSession } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
)

const event = {
  node: { req: { headers: {}, socket: { remoteAddress: '203.0.113.9' } } }
} as any

const setRow = (row: unknown) => {
  ;(globalThis as any).__sessionRow = row
}
const resetInserts = () => {
  ;(globalThis as any).__insertCalls = 0
}

test('伪造令牌的 jti 查不到会话时返回 null，且不自动建会话', async () => {
  setRow(null)
  resetInserts()

  const result = await ensureAuthSession(event, {
    userId: 1,
    jti: 'forged-jti-does-not-exist',
    exp: Math.floor(Date.now() / 1000) + 3600
  })

  assert.equal(result, null)
  assert.equal((globalThis as any).__insertCalls, 0, '不得为未知 jti 插入会话记录')
})

test('会话存在但归属与令牌不一致时返回 null', async () => {
  setRow({ id: 'session-a', userId: 2 })
  resetInserts()

  const result = await ensureAuthSession(event, { userId: 1, jti: 'session-a' })
  assert.equal(result, null)
  assert.equal((globalThis as any).__insertCalls, 0)
})

test('命中服务端签发的会话时正常返回', async () => {
  const row = { id: 'session-b', userId: 1 }
  setRow(row)

  const result = await ensureAuthSession(event, { userId: 1, jti: 'session-b' })
  assert.equal(result, row)
})

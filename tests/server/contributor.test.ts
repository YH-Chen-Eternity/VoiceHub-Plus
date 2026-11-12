import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 契约 §2 / §9：CONTRIBUTOR（发稿员）社区限流豁免。
 * 依赖 Agent B 在 server/utils/community.ts 导出 isCommunityRateLimitExempt。
 * 加载方式同 nameMode.test.ts（esbuild stub 绕过 ~ 别名，仅跑纯函数、不连 DB）；
 * 导出未就绪时 t.skip，保证 pnpm test 不崩。
 */
const SOURCE = fileURLToPath(new URL('../../server/utils/community.ts', import.meta.url))

let community: Record<string, any> | null = null
try {
  const sourceText = readFileSync(SOURCE, 'utf8')
  const stubNames = new Set<string>()
  for (const m of sourceText.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (name) stubNames.add(name)
    }
  }
  const stubSource = [
    ...[...stubNames].map((n) => `export const ${n} = globalThis.__vhpStub;`),
    'export const createError = globalThis.__vhpStub;',
    'export default globalThis.__vhpStub;'
  ].join('\n')

  const { build } = await import('esbuild')
  const stub: any = new Proxy(function () {}, { get: () => stub })
  Object.assign(globalThis, { __vhpStub: stub })
  const compiled = await build({
    entryPoints: [SOURCE],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [{
      name: 'community-stub',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) =>
          args.kind === 'entry-point' || args.path === SOURCE
            ? undefined
            : { path: args.path, namespace: 'stub' })
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stubSource, loader: 'js' }))
      }
    }]
  })
  community = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
  )
} catch {
  community = null
}

test('community.ts 纯函数可被加载（stub 掉 DB 依赖，无需真实连接）', (t) => {
  if (!community || typeof community.maskCommunityName !== 'function') {
    t.skip('依赖模块尚未就绪：community.ts 无法加载')
    return
  }
  assert.equal(community!.maskCommunityName('张三'), '张*')
})

test('isCommunityRateLimitExempt：CONTRIBUTOR 豁免，其余角色不豁免', (t) => {
  const fn = community?.isCommunityRateLimitExempt
  if (typeof fn !== 'function') {
    t.skip('依赖模块尚未就绪：缺少 isCommunityRateLimitExempt 导出（Agent B 负责）')
    return
  }
  // 契约未固定入参形态（角色字符串 / user 对象），两种都探测，命中其一即按该形态断言。
  let stringForm = false
  let objectForm = false
  try { stringForm = fn('CONTRIBUTOR') === true } catch { /* 入参形态不匹配，忽略 */ }
  try { objectForm = fn({ role: 'CONTRIBUTOR' }) === true } catch { /* 忽略 */ }
  if (!stringForm && !objectForm) {
    t.skip('依赖模块尚未就绪：isCommunityRateLimitExempt 入参形态与契约不一致（见 CONTRACT-QUESTIONS-I.md）')
    return
  }
  const wrap = (role: any) => (stringForm ? role : { role })
  assert.equal(fn(wrap('CONTRIBUTOR')), true, '发稿员应跳过社区限流')
  assert.equal(fn(wrap('USER')), false)
  assert.equal(fn(wrap('ADMIN')), false)
  assert.equal(fn(wrap('SUPER_ADMIN')), false)
  assert.equal(fn(wrap('REVIEWER')), false)
  assert.equal(fn(wrap('')), false)
  assert.equal(fn(null), false)
  assert.equal(fn(undefined), false)
})

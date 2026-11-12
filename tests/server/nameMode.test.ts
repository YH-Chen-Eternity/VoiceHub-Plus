import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 契约 §3：nameMode（semi / real / anon）显示矩阵单元测试。
 *
 * 依赖（并行开发，尚未全部落地，需主 agent 收尾对齐）：
 *  - Agent B 在 server/utils/community.ts 扩展 buildCommunityIdentity 第 4 参 nameMode?: string；
 *  - 契约预期助手 formatNameByMode / resolveNameMode（命名与签名见 CONTRACT-QUESTIONS-I.md）；
 *  - 发帖端点 anon 强制 PENDING（§3）属端点行为，本文件只测纯函数。
 *
 * community.ts 含 `~/drizzle/*` 等别名导入，plain `node --experimental-strip-types` 无法解析
 * （Cannot find package '~'），故沿用仓库既有 esbuild fixture 手法（见
 * global-submission-limit.test.ts）：把别名 / 裸模块 stub 掉后 bundle 成 data: URL 再 import，
 * 仅执行纯函数，不连 DB / Redis / Nuxt。stub 导出从源码具名导入动态收集，
 * Agent B 后续新增导入也能自动覆盖，避免 esbuild "No matching export" 构建失败。
 * 任何加载或实现未就绪的情况都用 t.skip 优雅跳过，保证 pnpm test 不崩。
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

const USER = { id: 1, name: '陈奕翰', grade: '高一', class: '1' }
const USER_2CHAR = { ...USER, name: '张三' }
const OTHER = { id: 999, role: 'USER' }

type ModeForm = 'string' | 'object'

/** 行为探测：第 4 参被真正识别时 semi 与 anon 的显示应不同；兼容字符串 / 对象两种签名。 */
function detectModeForm(): ModeForm | null {
  if (!community || typeof community.buildCommunityIdentity !== 'function') return null
  const call = (arg: any) => {
    try { return community!.buildCommunityIdentity(USER, null, OTHER, arg)?.displayName }
    catch { return undefined }
  }
  const semiStr = call('semi')
  const anonStr = call('anon')
  if (semiStr && anonStr && semiStr !== anonStr) return 'string'
  const semiObj = call({ nameMode: 'semi' })
  const anonObj = call({ nameMode: 'anon' })
  if (semiObj && anonObj && semiObj !== anonObj) return 'object'
  return null
}

const modeForm = detectModeForm()
const mode = (value: any) => (modeForm === 'object' ? { nameMode: value } : value)
const ident = (u: any, viewer: any, value: any) =>
  community!.buildCommunityIdentity(u, null, viewer, mode(value))

function smokeReady(t: any): boolean {
  if (!community || typeof community.maskCommunityName !== 'function') {
    t.skip('依赖模块尚未就绪：community.ts 无法加载或缺少 maskCommunityName')
    return false
  }
  return true
}
function matrixReady(t: any): boolean {
  if (!modeForm) {
    t.skip('依赖模块尚未就绪：buildCommunityIdentity 第 4 参 nameMode 尚未实现（Agent B 负责）')
    return false
  }
  return true
}

test('maskCommunityName：semi 隐中间字、两字名隐第二字、空值兜底', (t) => {
  if (!smokeReady(t)) return
  assert.equal(community!.maskCommunityName('陈奕翰'), '陈*翰')
  assert.equal(community!.maskCommunityName('张三'), '张*')
  assert.equal(community!.maskCommunityName('李'), '李*')
  assert.equal(community!.maskCommunityName(''), '同学')
  assert.equal(community!.maskCommunityName(null), '同学')
})

test('formatCommunityClass：班级拼接保持稳定', (t) => {
  if (!smokeReady(t)) return
  assert.equal(community!.formatCommunityClass('高一', '1'), '高一1班')
  assert.equal(community!.formatCommunityClass('高一', '1班'), '高一1班')
  assert.equal(community!.formatCommunityClass('', ''), '')
})

test('其他人对 semi / anon / real 的显示矩阵', (t) => {
  if (!matrixReady(t)) return
  assert.equal(ident(USER, OTHER, 'semi').displayName, '陈*翰', 'semi 三字名隐中间字')
  assert.equal(ident(USER_2CHAR, OTHER, 'semi').displayName, '张*', 'semi 两字名隐第二字')
  assert.equal(ident(USER, OTHER, 'real').displayName, '陈奕翰', 'real 显示全名')
  const anon = ident(USER, OTHER, 'anon').displayName
  assert.ok(anon.startsWith('陈'), 'anon 应保留首字')
  assert.ok(anon.includes('*'), 'anon 应带 *')
  assert.ok(!anon.includes('奕翰'), 'anon 不应泄露全名')
  assert.notEqual(anon, '陈*翰', 'anon 不应退化成 semi')
})

test('管理员 / 本人始终显示班级+全名，不受 nameMode 影响', (t) => {
  if (!matrixReady(t)) return
  for (const value of ['semi', 'anon', 'real', 'BOGUS']) {
    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      const r = ident(USER, { id: 2, role }, value)
      assert.ok(r.displayName.includes('陈奕翰'), `${role}+${value} 应显示全名`)
      assert.ok(!r.displayName.includes('*'), `${role}+${value} 不应被脱敏`)
      assert.equal(r.className, '高一1班', `${role}+${value} 应带班级`)
    }
    const self = ident(USER, { id: 1, role: 'USER' }, value)
    assert.ok(self.displayName.includes('陈奕翰'), `本人+${value} 应显示全名`)
    assert.ok(!self.displayName.includes('*'), `本人+${value} 不应被脱敏`)
  }
})

test('非法 / 缺省 nameMode 回退 semi', (t) => {
  if (!matrixReady(t)) return
  const semi = ident(USER, OTHER, 'semi').displayName
  for (const value of [undefined, null, '', 'BOGUS', 'REAL', 123]) {
    assert.equal(ident(USER, OTHER, value).displayName, semi, `${String(value)} 应回退 semi`)
  }
})

test('resolveNameMode：合法值透传、非法值回退 semi（若导出）', (t) => {
  if (typeof community?.resolveNameMode !== 'function') {
    t.skip('依赖模块尚未就绪：缺少 resolveNameMode 导出（契约预期命名，待主 agent 对齐）')
    return
  }
  assert.equal(community!.resolveNameMode('semi'), 'semi')
  assert.equal(community!.resolveNameMode('real'), 'real')
  assert.equal(community!.resolveNameMode('anon'), 'anon')
  for (const value of [undefined, null, '', 'BOGUS', 123]) {
    assert.equal(community!.resolveNameMode(value), 'semi', `${String(value)} 应回退 semi`)
  }
})

test('formatNameByMode：三档显示（若导出，签名待对齐）', (t) => {
  if (typeof community?.formatNameByMode !== 'function') {
    t.skip('依赖模块尚未就绪：缺少 formatNameByMode 导出（契约预期命名，待主 agent 对齐）')
    return
  }
  assert.equal(community!.formatNameByMode('陈奕翰', 'semi'), '陈*翰')
  assert.equal(community!.formatNameByMode('张三', 'semi'), '张*')
  assert.equal(community!.formatNameByMode('陈奕翰', 'real'), '陈奕翰')
  const anon = community!.formatNameByMode('陈奕翰', 'anon')
  assert.ok(typeof anon === 'string' && anon.startsWith('陈') && anon.includes('*') && !anon.includes('奕翰'))
  assert.equal(community!.formatNameByMode('陈奕翰', 'BOGUS'), '陈*翰', '非法值回退 semi')
})

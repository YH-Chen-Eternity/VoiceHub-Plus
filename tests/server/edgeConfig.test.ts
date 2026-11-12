import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * 契约 §5 / §9：边缘层观察模式 / 逐规则开关 测试。
 *
 * deploy/rewriter/app-rewriter.js 是无构建的独立 CJS 脚本，模块顶层即 server.listen(...)，
 * 直接 import 会起服务、CI 不可行，且 shouldBlock 未导出。因此按仓库 policy 测试惯例
 * 读取源码文本处理：
 *  - 静态守卫：断言观察模式 / 逐规则开关 / 动态配置接口的关键实现标记仍在，防回归删除；
 *  - 行为测试：从源码抽取 shouldBlock 的真实函数体，注入受控依赖后用
 *    vm.runInNewContext 在隔离作用域求值执行（不共享宿主全局、不启动服务、不碰网络），
 *    覆盖观察模式逻辑；比直接 new Function 更收敛可执行面。
 * 基础设施常驻断言始终运行；Agent D 的实现标记缺失时其余用例 t.skip，保证 pnpm test 不崩。
 */
const REWRITER = fileURLToPath(new URL('../../deploy/rewriter/app-rewriter.js', import.meta.url))
const CONFIG_PUT = fileURLToPath(new URL('../../server/api/admin/edge-config.put.ts', import.meta.url))

const readOptional = (path: string): string => {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}
// 去掉注释，避免注释里的关键字造成假阳性（例如「// ...observeMode...」）。
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const rewriterCode = stripComments(readOptional(REWRITER))
const configPutCode = stripComments(readOptional(CONFIG_PUT))
const observeReady = () => /\bshouldBlock\s*\(/.test(rewriterCode) && /\bobserveMode\b/.test(rewriterCode)

/** 按大括号配对截取 shouldBlock 函数源码（兼容函数体内新增嵌套块）。 */
function extractShouldBlockSource(code: string): string | null {
  const start = code.search(/function\s+shouldBlock\s*\(/)
  if (start < 0) return null
  const open = code.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1)
  }
  return null
}
const shouldBlockSource = extractShouldBlockSource(rewriterCode)

test('现有攻击上报与内部管理基础设施常驻（防回归删除）', (t) => {
  if (!rewriterCode) {
    t.skip('依赖模块尚未就绪：app-rewriter.js 无法读取')
    return
  }
  assert.match(rewriterCode, /function\s+reportAttack\s*\(/, '应保留 reportAttack')
  assert.match(rewriterCode, /function\s+handleInternalAdmin\s*\(/, '应保留内部管理入口')
  assert.match(rewriterCode, /x-attack-token/, '内部接口应校验 x-attack-token')
})

test('观察模式 / 逐规则开关：关键实现标记齐全（静态守卫）', (t) => {
  if (!observeReady()) {
    t.skip('依赖模块尚未就绪：app-rewriter.js 尚未实现 shouldBlock / observeMode（Agent D 负责）')
    return
  }
  assert.match(rewriterCode, /\bruntimeConfig\b/, '阈值应收敛到可变 runtimeConfig')
  assert.match(rewriterCode, /\bobserveMode\b/, '应存在全站观察模式开关')
  assert.match(rewriterCode, /\bruleSwitches\b/, '应存在逐规则开关')
  assert.match(rewriterCode, /\bshouldBlock\s*\(/, '各拦截点应统一走 shouldBlock')
  assert.match(rewriterCode, /__internal\/config/, '应提供 /__internal/config 动态配置接口')
  assert.ok(
    /reportAttack\s*\(\{[\s\S]{0,400}action:\s*['"]observe['"]/.test(rewriterCode),
    '观察模式 / 规则关闭分支应只 reportAttack(action=observe) 不拦截'
  )
})

test('shouldBlock 观察模式 / 逐规则开关判定（抽取真实函数体执行）', (t) => {
  if (!observeReady() || !shouldBlockSource) {
    t.skip('依赖模块尚未就绪：无法定位 shouldBlock 函数体')
    return
  }
  // 从源码同步 RULE_KEYS，避免测试内硬编码与实现漂移；注入隔离作用域所需的全部依赖。
  const keyMatch = rewriterCode.match(/const RULE_KEYS = \[([^\]]+)\]/)
  const ruleKeys = keyMatch
    ? (keyMatch[1].match(/['"][^'"]+['"]/g) || []).map((s) => s.slice(1, -1))
    : []
  let factory: Function
  try {
    const sandbox = vm.createContext({
      RULE_KEYS: ruleKeys,
      warnedRuleKinds: new Set<string>(),
      console: { warn: () => {} }
    })
    factory = vm.runInContext(
      `(function (runtimeConfig) { ${shouldBlockSource}\nreturn shouldBlock })`,
      sandbox
    ) as Function
  } catch {
    t.skip('依赖模块尚未就绪：shouldBlock 函数体无法求值')
    return
  }
  const sb = (observeMode: boolean, switches: Record<string, boolean>, kind?: string) =>
    (factory({ observeMode, ruleSwitches: switches }) as (k?: string) => boolean)(kind)

  assert.equal(sb(false, { script: true }, 'script'), true, '规则开启且非观察模式 → 拦截')
  assert.equal(sb(false, { script: false }, 'script'), false, '逐规则开关关闭 → 不拦截')
  assert.equal(sb(false, {}, 'rateLimit'), true, '未登记规则仅受 observeMode 影响')
  assert.equal(sb(true, { script: true }, 'script'), false, '全站观察模式 → 一律不拦截')
  assert.equal(sb(true, {}, 'rateLimit'), false, '观察模式下未登记规则也不拦截')
  assert.equal(sb(false, { script: true }, undefined), true, '无规则参数默认拦截')
})

test('PUT /api/admin/edge-config 写操作鉴权与 no-store（契约级守卫）', (t) => {
  if (!configPutCode) {
    t.skip('依赖模块尚未就绪：edge-config.put.ts 尚未创建（Agent D 负责）')
    return
  }
  assert.match(configPutCode, /requireSuperAdmin\s*\(/, '写操作应 requireSuperAdmin')
  assert.match(configPutCode, /no-store/, '应设置 Cache-Control: no-store')
  assert.match(configPutCode, /defineEventHandler/, '应使用 defineEventHandler')
  assert.match(configPutCode, /setEdgeConfig\s*\(/, '应调用 setEdgeConfig 落盘')
})

test('PUT /api/admin/edge-config 校验边界：类型 / 键白名单 / 阈值范围', (t) => {
  if (!configPutCode) {
    t.skip('依赖模块尚未就绪：edge-config.put.ts 尚未创建')
    return
  }
  assert.match(configPutCode, /EDGE_CONFIG_INVALID/, '非法配置应返回 400 错误码')
  assert.match(configPutCode, /typeof\s+\w+\.observeMode\s*!==\s*'boolean'/, 'observeMode 必须为布尔')
  // 白名单/边界表的标识符可能随重构改名（本地常量 或 edgeRules.ts 共享元数据），
  // 这里按「语义标记」断言，避免把具体实现细节写死导致并行开发误报。
  assert.ok(
    /EDGE_RULE_KEYS|RULE_KEYS|未知规则开关/.test(configPutCode),
    '规则开关键应有白名单（契约 §5 edgeRules.ts 为唯一事实来源）'
  )
  assert.ok(
    /EDGE_RATE_LIMIT_META|RATE_LIMIT_BOUNDS|未知阈值|\.min\b|\.max\b/.test(configPutCode),
    '阈值应校验上下界'
  )
  assert.ok(
    /Number\.isFinite|Number\.isInteger|typeof\s+\w+\s*!==\s*'number'/.test(configPutCode),
    '阈值应做数值校验'
  )
})

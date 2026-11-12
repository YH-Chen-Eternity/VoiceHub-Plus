import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 契约 §4：app/utils/timeUtils.ts 新增 formatDateOnly(value) → YYYY/M/D（Asia/Shanghai），
 * 且「不改 formatDateTime」。该模块用 dayjs、无 ~ 别名，node --experimental-strip-types
 * 可直接动态 import；实现未落地时所有用例 t.skip，保证 pnpm test 不崩。
 */
let timeUtils: Record<string, any> | null = null
try {
  timeUtils = await import('../../app/utils/timeUtils.ts')
} catch {
  timeUtils = null
}

function ready(t: any): boolean {
  if (!timeUtils || typeof timeUtils.formatDateOnly !== 'function') {
    t.skip('依赖模块尚未就绪：app/utils/timeUtils.ts 缺少 formatDateOnly 导出（主 agent 实现）')
    return false
  }
  return true
}

test('timeUtils 仍导出 formatDateTime（契约要求不改动）', (t) => {
  if (!timeUtils) {
    t.skip('依赖模块尚未就绪：timeUtils 无法加载')
    return
  }
  assert.equal(typeof timeUtils.formatDateTime, 'function')
})

test('Date 对象 / ISO 字符串 / 时间戳均得到北京日期 YYYY/M/D', (t) => {
  if (!ready(t)) return
  const f = timeUtils!.formatDateOnly
  assert.equal(f(new Date('2026-01-05T02:00:00Z')), '2026/1/5')
  assert.equal(f('2026-01-05T02:00:00Z'), '2026/1/5')
  assert.equal(f(Date.parse('2026-01-05T02:00:00Z')), '2026/1/5')
  assert.equal(f(new Date('2026-11-12T02:00:00Z')), '2026/11/12')
})

test('null / undefined / 非法值返回空串', (t) => {
  if (!ready(t)) return
  const f = timeUtils!.formatDateOnly
  assert.equal(f(null), '')
  assert.equal(f(undefined), '')
  assert.equal(f(''), '')
  assert.equal(f('not-a-date'), '')
})

test('跨时区边界：UTC 16:xx 算次日北京日期，含跨月 / 跨年', (t) => {
  if (!ready(t)) return
  const f = timeUtils!.formatDateOnly
  assert.equal(f(new Date('2026-01-05T15:59:00Z')), '2026/1/5', 'UTC 15:59 仍是北京当日 23:59')
  assert.equal(f(new Date('2026-01-05T16:30:00Z')), '2026/1/6', 'UTC 16:30 已是北京次日 00:30')
  assert.equal(f(new Date('2026-11-12T16:00:00Z')), '2026/11/13')
  assert.equal(f(new Date('2026-12-31T16:00:00Z')), '2027/1/1', '跨年边界')
})

test('月 / 日不补零（YYYY/M/D 而非 YYYY/MM/DD）', (t) => {
  if (!ready(t)) return
  const f = timeUtils!.formatDateOnly
  const sample = f(new Date('2026-01-05T02:00:00Z'))
  assert.equal(f(new Date('2026-03-07T02:00:00Z')), '2026/3/7')
  assert.match(sample, /^\d{4}\/\d{1,2}\/\d{1,2}$/)
  assert.ok(!sample.includes('01/05'), '不应出现补零')
})

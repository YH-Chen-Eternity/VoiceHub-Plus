import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * V-01 回归：HS256 的信任根就是 JWT_SECRET。
 * 示例值、过短、低熵的密钥必须在启动期被拒绝，不能再出现「照抄 compose 默认值就能伪造令牌」。
 *
 * loadJwtSecret 每次调用都重新读取环境变量，所以这里可以逐条切换取值。
 */

const VALID_SECRET = 'K7mQ2xR9tL4vN8bW1cZ6yH3jF5dS0gAe'

// 模块加载时静态字段会执行一次校验，先放入合法值
process.env.JWT_SECRET = VALID_SECRET
const { loadJwtSecret } = await import('../../server/utils/jwt-enhanced.ts')

const withSecret = (value: string | undefined, fn: () => void) => {
  const previous = process.env.JWT_SECRET
  try {
    if (value === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = value
    fn()
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previous
  }
}

test('合法高熵密钥通过，并去除首尾空白', () => {
  withSecret(`  ${VALID_SECRET}  `, () => {
    assert.equal(loadJwtSecret(), VALID_SECRET)
  })
})

test('未配置或空值直接拒绝', () => {
  for (const value of [undefined, '', '   ']) {
    withSecret(value, () => {
      assert.throws(() => loadJwtSecret(), /JWT_SECRET environment variable is not set/)
    })
  }
})

test('长度不足 32 拒绝', () => {
  withSecret('K7mQ2xR9tL4vN8bW1cZ6yH3jF5dS0gA', () => {
    assert.throws(() => loadJwtSecret(), /长度必须 >= 32/)
  })
})

test('已知示例值与弱口令拒绝', () => {
  for (const value of [
    'your-jwt-secret-here-your-jwt-secret-here',
    'your-very-secure-jwt-secret-key-1234',
    'change-me-please-change-me-please-123',
    'secret',
    'changeme'
  ]) {
    withSecret(value, () => {
      assert.throws(() => loadJwtSecret(), /示例\/弱口令/, `${value} 应被拒绝`)
    })
  }
})

test('长度达标但字符种类过少拒绝', () => {
  withSecret('a'.repeat(64), () => {
    assert.throws(() => loadJwtSecret(), /熵过低/)
  })
})

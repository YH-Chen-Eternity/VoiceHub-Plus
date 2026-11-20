import assert from 'node:assert/strict'
import test from 'node:test'

// JWTEnhanced 在模块加载时校验密钥强度，必须先注入合法值再动态导入
process.env.JWT_SECRET = 'K7mQ2xR9tL4vN8bW1cZ6yH3jF5dS0gAe'
const { JWTEnhanced } = await import('../../server/utils/jwt-enhanced.ts')

test('预认证令牌必须携带当前 tokenVersion', () => {
  assert.equal(JWTEnhanced.hasCurrentTokenVersion({ tokenVersion: 3 }, 3), true)
  assert.equal(JWTEnhanced.hasCurrentTokenVersion({ tokenVersion: 2 }, 3), false)
})

test('迁移前或非法 tokenVersion 的预认证令牌按失效处理', () => {
  assert.equal(JWTEnhanced.hasCurrentTokenVersion({}, 0), false)
  assert.equal(JWTEnhanced.hasCurrentTokenVersion({ tokenVersion: '0' }, 0), false)
  assert.equal(JWTEnhanced.hasCurrentTokenVersion(null, 0), false)
})

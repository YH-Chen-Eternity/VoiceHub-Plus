import assert from 'node:assert/strict'
import { test } from 'node:test'

import { issueResetTicket, verifyResetTicket } from '../../server/utils/password-reset-ticket.ts'

process.env.JWT_SECRET = 'test-secret-for-reset-ticket'

// 找回密码第二步凭票据放行：票据必须绑定账号、限时、且不可伪造
test('第一步签发的票据可以放行第二步', () => {
  const ticket = issueResetTicket('alice')
  assert.equal(verifyResetTicket(ticket, 'alice'), true)
})

test('票据绑定账号，换成别的账号不认', () => {
  const ticket = issueResetTicket('alice')
  assert.equal(verifyResetTicket(ticket, 'bob'), false)
})

test('账号大小写与首尾空格不影响校验', () => {
  const ticket = issueResetTicket(' Alice ')
  assert.equal(verifyResetTicket(ticket, 'alice'), true)
})

test('超过 10 分钟失效', () => {
  const issuedAt = 1_700_000_000_000
  const ticket = issueResetTicket('alice', issuedAt)
  assert.equal(verifyResetTicket(ticket, 'alice', issuedAt + 9 * 60 * 1000), true)
  assert.equal(verifyResetTicket(ticket, 'alice', issuedAt + 11 * 60 * 1000), false)
})

test('篡改载荷或签名一律拒绝', () => {
  const ticket = issueResetTicket('alice')
  const [body, mac] = ticket.split('.')
  const forgedBody = Buffer.from(`bob|${Date.now() + 60_000}`, 'utf8').toString('base64url')

  assert.equal(verifyResetTicket(`${forgedBody}.${mac}`, 'bob'), false)
  assert.equal(verifyResetTicket(`${body}.${mac.slice(0, -2)}xx`, 'alice'), false)
  assert.equal(verifyResetTicket(body, 'alice'), false)
})

test('空值与非字符串直接拒绝', () => {
  assert.equal(verifyResetTicket(undefined, 'alice'), false)
  assert.equal(verifyResetTicket(null, 'alice'), false)
  assert.equal(verifyResetTicket('', 'alice'), false)
  assert.equal(verifyResetTicket(123, 'alice'), false)
})

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

test('账号大小写不同即拒绝（数据库按原样比对，不做折叠）', () => {
  const ticket = issueResetTicket('alice')
  assert.equal(verifyResetTicket(ticket, 'Alice'), false)
  assert.equal(verifyResetTicket(ticket, ' alice '), true)
})

test('超过 10 分钟失效', () => {
  const issuedAt = 1_700_000_000_000
  const ticket = issueResetTicket('alice', issuedAt)
  assert.equal(verifyResetTicket(ticket, 'alice', issuedAt + 9 * 60 * 1000), true)
  assert.equal(verifyResetTicket(ticket, 'alice', issuedAt + 11 * 60 * 1000), false)
})

test('篡改载荷或签名一律拒绝', () => {
  const ticket = issueResetTicket('alice')
  const at = ticket.lastIndexOf('.')
  const forged = Buffer.from(`bob|${Date.now() + 60_000}`, 'utf8').toString('base64url')

  assert.equal(verifyResetTicket(`${forged}${ticket.slice(at)}`, 'bob'), false)
  assert.equal(verifyResetTicket(`${ticket.slice(0, at)}.AAAA`, 'alice'), false)
  assert.equal(verifyResetTicket(ticket.slice(0, at), 'alice'), false)
})

test('空值、非字符串与缺失密钥都安全返回 false', () => {
  assert.equal(verifyResetTicket(undefined, 'alice'), false)
  assert.equal(verifyResetTicket(null, 'alice'), false)
  assert.equal(verifyResetTicket('', 'alice'), false)
  assert.equal(verifyResetTicket(123, 'alice'), false)

  const ticket = issueResetTicket('alice')
  const saved = process.env.JWT_SECRET
  delete process.env.JWT_SECRET
  assert.equal(verifyResetTicket(ticket, 'alice'), false)
  process.env.JWT_SECRET = saved
})

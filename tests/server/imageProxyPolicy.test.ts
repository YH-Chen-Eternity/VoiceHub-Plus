import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isHostnameAllowed,
  isPortAllowed,
  parseAllowedHosts
} from '../../server/utils/imageProxyPolicy.ts'

test('白名单解析：空值不限制', () => {
  assert.deepEqual(parseAllowedHosts(''), [])
  assert.deepEqual(parseAllowedHosts(undefined), [])
  assert.deepEqual(parseAllowedHosts(null), [])
  assert.equal(isHostnameAllowed('anything.example', []), true)
})

test('白名单解析：逗号分隔、去空格、归一化大小写与通配前缀', () => {
  assert.deepEqual(
    parseAllowedHosts(' Music.126.net , *.hdslb.com ,.y.qq.com '),
    ['music.126.net', 'hdslb.com', 'y.qq.com']
  )
  assert.deepEqual(parseAllowedHosts('a.com,,  ,b.com'), ['a.com', 'b.com'])
})

test('域名匹配：精确与子域命中', () => {
  const list = ['music.126.net', 'hdslb.com']
  assert.equal(isHostnameAllowed('music.126.net', list), true)
  assert.equal(isHostnameAllowed('p1.music.126.net', list), true)
  assert.equal(isHostnameAllowed('i0.hdslb.com', list), true)
  assert.equal(isHostnameAllowed('HDSLB.COM', list), true)
})

test('域名匹配：后缀边界严格匹配，不做尾串包含', () => {
  const list = ['hdslb.com']
  assert.equal(isHostnameAllowed('evilhdslb.com', list), false)
  assert.equal(isHostnameAllowed('hdslb.com.evil.net', list), false)
})

test('域名匹配：IPv6 方括号与空主机名', () => {
  assert.equal(isHostnameAllowed('[::1]', ['::1']), true)
  assert.equal(isHostnameAllowed('', ['a.com']), false)
})

test('端口白名单：默认端口与 80/443 放行，其余拒绝', () => {
  for (const port of ['', '80', '443']) {
    assert.equal(isPortAllowed(port), true, `${port || '(默认)'} 应放行`)
  }
  for (const port of ['6379', '8080', '9443', '22']) {
    assert.equal(isPortAllowed(port), false, `${port} 应拒绝`)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  API_ALLOWED_METHODS,
  PAGE_ALLOWED_METHODS,
  checkRequestMethod,
  isApiPath
} from '../../server/utils/httpMethodPolicy.ts'

test('页面路径只接受安全方法', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(checkRequestMethod('/', method).allowed, true, `${method} 应放行`)
  }
  for (const method of ['PUT', 'DELETE', 'PATCH', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'TRACE', 'CONNECT']) {
    assert.equal(checkRequestMethod('/', method).allowed, false, `${method} 应拒绝`)
  }
})

test('API 路径接受应用实际使用的写方法', () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.equal(checkRequestMethod('/api/community/posts/1', method).allowed, true, `${method} 应放行`)
  }
})

test('API 路径仍拒绝 WebDAV 与隧道方法', () => {
  for (const method of ['PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'TRACE', 'CONNECT']) {
    assert.equal(checkRequestMethod('/api/songs/public', method).allowed, false, `${method} 应拒绝`)
  }
})

test('/api 精确路径按 API 处理，/apixxx 不算 API', () => {
  assert.equal(isApiPath('/api'), true)
  assert.equal(isApiPath('/api/'), true)
  assert.equal(isApiPath('/apixxx'), false)
  assert.equal(checkRequestMethod('/api', 'DELETE').allowed, true)
  assert.equal(checkRequestMethod('/apixxx', 'DELETE').allowed, false)
})

test('方法名大小写与空白归一化', () => {
  assert.equal(checkRequestMethod('/', ' get ').allowed, true)
  assert.equal(checkRequestMethod('/', 'propfind').allowed, false)
})

test('空方法与未知方法一律拒绝', () => {
  assert.equal(checkRequestMethod('/', '').allowed, false)
  assert.equal(checkRequestMethod('/', 'FOOBAR').allowed, false)
})

test('Allow 头内容与路径匹配', () => {
  assert.deepEqual([...checkRequestMethod('/', 'PUT').allow], [...PAGE_ALLOWED_METHODS])
  assert.deepEqual([...checkRequestMethod('/api/x', 'PROPFIND').allow], [...API_ALLOWED_METHODS])
})

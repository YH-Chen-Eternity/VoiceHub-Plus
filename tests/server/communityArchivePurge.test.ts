import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PURGE_BATCH_SIZE,
  PURGE_MAX_IDS,
  PURGE_MAX_TOTAL,
  normalizeArchivePurgeType,
  normalizePurgeIds,
  normalizeArchivePurgeRequest
} from '../../server/utils/communityArchivePurge.ts'

test('归档类型归一化：兼容单复数与大小写，拒绝非法值', () => {
  assert.equal(normalizeArchivePurgeType('post'), 'post')
  assert.equal(normalizeArchivePurgeType('posts'), 'post')
  assert.equal(normalizeArchivePurgeType('comment'), 'comment')
  assert.equal(normalizeArchivePurgeType('COMMENTS'), 'comment')
  assert.equal(normalizeArchivePurgeType(''), null)
  assert.equal(normalizeArchivePurgeType(null), null)
  assert.equal(normalizeArchivePurgeType('user'), null)
})

test('id 白名单：只保留正整数、去重且保序，非数组返回空', () => {
  assert.deepEqual(normalizePurgeIds([3, 1, 3, '5', 0, -2, 2.5, null, 'x']), [3, 1, 5])
  assert.deepEqual(normalizePurgeIds(undefined), [])
  assert.deepEqual(normalizePurgeIds({ 0: 1 }), [])
})

test('范围清空：all=true 且无 ids 时通过，板块条件生效', () => {
  const r = normalizeArchivePurgeRequest({ type: 'posts', all: true, boardId: 7 })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.value, { type: 'post', all: true, boardId: 7, ids: undefined })
})

test('范围清空：不传板块时 boardId 为 undefined，表示全部板块', () => {
  const r = normalizeArchivePurgeRequest({ type: 'comments', all: true })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.value.type, 'comment')
  assert.equal(r.value.boardId, undefined)
  assert.equal(r.value.ids, undefined)
})

test('单条删除：传 ids 即通过，且忽略板块条件避免筛选竞态', () => {
  const r = normalizeArchivePurgeRequest({ type: 'post', ids: [42], boardId: 3 })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.value, { type: 'post', all: false, boardId: undefined, ids: [42] })
})

test('安全边界：空 ids 且非 all 必须拒绝，杜绝误删全站', () => {
  for (const body of [
    { type: 'posts' },
    { type: 'posts', ids: [] },
    { type: 'posts', ids: 'oops' },
    { type: 'posts', all: false }
  ]) {
    const r = normalizeArchivePurgeRequest(body)
    assert.equal(r.ok, false, `应拒绝 ${JSON.stringify(body)}`)
    if (!r.ok) assert.equal(r.code, 'COMMUNITY_ARCHIVE_PURGE_INVALID')
  }
})

test('安全边界：all 与 ids 互斥、ids 超上限、类型非法均拒绝', () => {
  assert.equal(normalizeArchivePurgeRequest({ type: 'posts', all: true, ids: [1] }).ok, false)
  assert.equal(
    normalizeArchivePurgeRequest({ type: 'posts', ids: Array.from({ length: PURGE_MAX_IDS + 1 }, (_, i) => i + 1) }).ok,
    false
  )
  assert.equal(normalizeArchivePurgeRequest({ type: 'unknown', all: true }).ok, false)
  assert.equal(normalizeArchivePurgeRequest(null).ok, false)
  assert.equal(normalizeArchivePurgeRequest('bad').ok, false)
})

test('boardId 只接受正整数，0 / 负数 / 非整数 / 非数字回落全部板块', () => {
  for (const boardId of [0, -1, 1.5, 'abc', null, undefined]) {
    const r = normalizeArchivePurgeRequest({ type: 'posts', all: true, boardId })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.value.boardId, undefined, `boardId=${String(boardId)}`)
  }
  const ok = normalizeArchivePurgeRequest({ type: 'posts', all: true, boardId: '9' })
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.value.boardId, 9)
})

test('批量上限为有界值，且单批不超过累计上限', () => {
  assert.ok(PURGE_BATCH_SIZE > 0 && PURGE_BATCH_SIZE <= PURGE_MAX_TOTAL)
  assert.ok(PURGE_MAX_IDS <= PURGE_BATCH_SIZE)
  assert.ok(Number.isInteger(PURGE_MAX_TOTAL))
})

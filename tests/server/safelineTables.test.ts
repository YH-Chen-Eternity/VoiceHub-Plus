/**
 * safelineTables 契約測試 — 表結構候選與官方枚舉映射。
 * 不連真實資料庫，僅驗證匯出形狀與映射正確性（碼值以雷池官方
 * chaitin/safeline management/webserver/pkg/constants/detectlog.go 為準）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SAFELINE_ATTACK_TYPES, SL } from '../../server/utils/safelineEnums.ts'

test('SL 候選表含免費版實測表名', () => {
  assert.ok(SL.attackTables.includes('mgt_detect_log_basic'))
  assert.ok(SL.attackTables.includes('mgt_attack_log'))
  assert.ok(SL.aggTables.includes('mgt_statistics_agg'))
  assert.ok(SL.ipTables.includes('statistics_ips'))
})

test('免費版時間欄位為秒級 epoch、地區欄位為 country', () => {
  assert.equal(SL.timeMode, 'epochSec')
  assert.equal(SL.col.time, 'timestamp')
  assert.equal(SL.col.ip, 'src_ip')
  assert.equal(SL.col.type, 'attack_type')
  assert.equal(SL.col.region, 'country')
})

test('官方 attack_type 碼值映射（生產實測出現的碼）', () => {
  // 生產 24h 分佈：14(信息泄露) 9(命令注入) 0(SQL 注入) 1(XSS)
  assert.equal(SAFELINE_ATTACK_TYPES[14], '信息泄露')
  assert.equal(SAFELINE_ATTACK_TYPES[9], '命令注入')
  assert.equal(SAFELINE_ATTACK_TYPES[0], 'SQL 注入')
  assert.equal(SAFELINE_ATTACK_TYPES[1], 'XSS')
  assert.equal(SAFELINE_ATTACK_TYPES[21], '扫描器')
  assert.equal(SAFELINE_ATTACK_TYPES[63], '威胁情报')
  // 負值流量標記
  assert.equal(SAFELINE_ATTACK_TYPES[-3], '黑名单')
  assert.equal(SAFELINE_ATTACK_TYPES[-1], '非攻击')
})

test('映射覆蓋官方 0-35 與 61-64 區段', () => {
  for (let code = 0; code <= 35; code++) {
    assert.ok(SAFELINE_ATTACK_TYPES[code], `缺碼 ${code}`)
  }
  for (const code of [61, 62, 63, 64]) {
    assert.ok(SAFELINE_ATTACK_TYPES[code], `缺碼 ${code}`)
  }
})

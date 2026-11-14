import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describePeakOnline, formatMomentShort } from '../../app/components/OpsBoard/format.js'

/**
 * 运维看板「时段峰值在线人数」的展示逻辑与数据链路契约。
 *
 * 展示逻辑（formatMomentShort / describePeakOnline）直接测真函数；
 * 采样与查询依赖 Redis／PG，CI 无法起服务，按仓库惯例对其源码做静态守卫，
 * 防止有人把区间过滤或采样周期改坏却不改文档。
 */

const src = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

// 一律用本地时间构造，避免测试机时区（CI 常为 UTC）影响期望值
const at = (...args: [number, number, number, number, number]) =>
  new Date(args[0], args[1] - 1, args[2], args[3], args[4]).getTime()

test('同一天只显示时分，跨天补月-日', () => {
  const now = at(2026, 11, 14, 10, 0)
  assert.equal(formatMomentShort(at(2026, 11, 14, 14, 32), now), '14:32')
  assert.equal(formatMomentShort(at(2026, 11, 13, 20, 5), now), '11-13 20:05')
  assert.equal(formatMomentShort(at(2025, 12, 31, 23, 59), now), '12-31 23:59')
})

test('同一年的不同月份跨天时仍补日期（按天比较，不按年比较）', () => {
  const now = at(2026, 11, 1, 0, 10)
  assert.equal(formatMomentShort(at(2026, 10, 31, 23, 50), now), '10-31 23:50')
})

test('非法时间戳返回空串，不抛异常', () => {
  assert.equal(formatMomentShort(Number.NaN), '')
  assert.equal(formatMomentShort(undefined), '')
})

test('有峰值时给出数值、单位与出现时刻', () => {
  const now = at(2026, 11, 14, 10, 0)
  const info = describePeakOnline({ online: 47, at: at(2026, 11, 14, 9, 31), since: 1 }, now)
  assert.equal(info.value, 47)
  assert.equal(info.text, '47')
  assert.equal(info.unit, '人')
  assert.equal(info.sub, '09:31 出现')
  assert.equal(info.hasData, true)
})

test('区间内无采样时显示统计起点，而不是 0', () => {
  const now = at(2026, 11, 14, 10, 0)
  const info = describePeakOnline(
    { online: null, at: null, since: at(2026, 11, 14, 9, 58) },
    now
  )
  assert.equal(info.value, null)
  assert.equal(info.text, '—')
  assert.equal(info.unit, '')
  assert.equal(info.sub, '统计自 09:58')
  assert.equal(info.hasData, false)
})

test('采样尚未产生任何数据时给出启动中提示', () => {
  const info = describePeakOnline({ online: null, at: null, since: null })
  assert.equal(info.text, '—')
  assert.equal(info.sub, '采样启动中')
})

test('peak 缺失（接口降级）不崩，按无数据处理', () => {
  for (const input of [null, undefined, {}]) {
    const info = describePeakOnline(input)
    assert.equal(info.hasData, false)
    assert.equal(info.text, '—')
  }
})

test('realtime 接口按所选区间取峰值，并回传统计起点', () => {
  const realtime = src('server/api/ops-board/realtime.get.ts')
  assert.match(realtime, /parseOpsRange\(event\)/)
  assert.match(realtime, /gte\(opsBoardOnlineSamples\.bucketAt,\s*info\.startTime\.getTime\(\)\)/)
  assert.match(realtime, /orderBy\(desc\(opsBoardOnlineSamples\.online\),\s*asc\(opsBoardOnlineSamples\.bucketAt\)\)/)
  assert.match(realtime, /since/)
  // 峰值查询失败不能把在线人数一起拖垮
  assert.match(realtime, /safeQuery/)
})

test('采样任务每分钟把窗口内去重 IP 数落库，并限制保留期', () => {
  const sampler = src('server/plugins/online-peak-sampler.ts')
  assert.match(sampler, /SAMPLE_INTERVAL_MS = 60 \* 1000/)
  assert.match(sampler, /PRESENCE_WINDOW_MS = 5 \* 60 \* 1000/)
  assert.match(sampler, /RETENTION_DAYS = 365/)
  assert.match(sampler, /zCount\(/)
  assert.match(sampler, /onConflictDoUpdate/)
  // 定时器必须 unref，避免阻断进程退出
  assert.match(sampler, /\.unref\?\.\(\)/)
  // 热重载/关闭时要清掉定时器，否则旧实例仍在采样
  assert.match(sampler, /hooks\.hook\('close'/)
})

test('迁移文件创建采样表且主键为分钟桶', () => {
  const migration = src('app/drizzle/migrations/20261114072640_ops-board-online-sample.sql')
  assert.match(migration, /CREATE TABLE "OpsBoardOnlineSample"/)
  assert.match(migration, /"bucketAt" bigint PRIMARY KEY NOT NULL/)
  assert.match(migration, /"online" integer NOT NULL/)
})

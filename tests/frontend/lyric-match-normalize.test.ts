import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLyricText } from '../../app/utils/lyric/lyricNormalize.ts'

// normalizeLyricText 是歌词跨来源一致性比较的唯一归一化入口。
// 修复点：先繁→简统一，避免同一首歌网易云（简）/ QQ 音乐（繁）被判成内容不一致。

const SIMPLIFIED = `我们都在不断赶路忘记了出路
在失望中追求偶尔的满足
我们都在梦中解脱清醒的苦
流浪在灯火阑珊处`

const TRADITIONAL = `我們都在不斷趕路忘記了出路
在失望中追求偶爾的滿足
我們都在夢中解脫清醒的苦
流浪在燈火闌珊處`

test('繁体歌词归一化后与简体完全一致', () => {
  assert.equal(normalizeLyricText(TRADITIONAL), normalizeLyricText(SIMPLIFIED))
})

test('归一化仍去除标点、空白并统一大小写（不因繁简统一而失效）', () => {
  assert.equal(normalizeLyricText('Hello, World!'), 'helloworld')
  assert.equal(normalizeLyricText('  a b\tc\n'), 'abc')
})

test('真实不同的歌词归一化后仍不同（不掩盖内容差异）', () => {
  const different = `完全不同的另一首歌
第二行也毫不相干
第三行没有关系`
  assert.notEqual(normalizeLyricText(SIMPLIFIED), normalizeLyricText(different))
})

test('空串与纯标点安全返回空归一化结果', () => {
  assert.equal(normalizeLyricText(''), '')
  assert.equal(normalizeLyricText(' ，。！？—— '), '')
})

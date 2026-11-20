import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

/**
 * 工具通过 `~~/` 别名引用服务端模块，纯 Node 无法解析该别名，
 * 这里先用 esbuild 打包再加载，顺带覆盖别名解析。
 */
const utilSource = fileURLToPath(new URL('../../server/utils/neteaseRealIp.ts', import.meta.url))

const compiled = await build({
  entryPoints: [utilSource],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: {
    '~~/server/utils/ip-utils': fileURLToPath(
      new URL('../../server/utils/ip-utils.ts', import.meta.url)
    ),
    h3: fileURLToPath(new URL('../fixtures/h3-stub.ts', import.meta.url))
  }
})

const { isNeteaseRealIpEnabled, resolveNeteaseOutboundIp } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
)

test('访客公网 IPv4 / IPv6 原样作为出口 IP', () => {
  assert.equal(resolveNeteaseOutboundIp('113.108.1.10'), '113.108.1.10')
  assert.equal(resolveNeteaseOutboundIp('240e:3b0:1234::1'), '240e:3b0:1234::1')
})

test('私网 / 回环 / CGNAT / 非法值一律不注入 realIP', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '192.168.1.9',
    '172.20.0.2',
    '169.254.1.1',
    '100.64.0.9',
    '::1',
    'fd00::1',
    'fe80::1',
    // 非规范写法必须与压缩形等价，否则会被当成公网地址注入
    '0:0:0:0:0:0:0:1',
    'FE80:0:0:0:0:0:0:1',
    'FC00:0:0:0:0:0:0:1',
    // 带作用域 ID 的链路本地地址同样不是可透传地址
    'fe80::1%eth0',
    'unknown',
    '',
    'not-an-ip<script>'
  ]) {
    assert.equal(resolveNeteaseOutboundIp(ip), undefined, `${ip} 不应产生出口 IP`)
  }
})

test('不再回退任何地址池：拿不到访客地址就是 undefined', () => {
  // 回归保护：历史上这里会返回广东网段随机 IP，取消回退后必须为空
  assert.equal(resolveNeteaseOutboundIp(''), undefined)
  assert.equal(resolveNeteaseOutboundIp('10.0.0.1'), undefined)
})

test('透传前剥离 IPv6 作用域 ID，避免把 %zone 原样发给上游', () => {
  assert.equal(resolveNeteaseOutboundIp('240e:3b0:1234::1%eth0'), '240e:3b0:1234::1')
})

test('NETEASE_REAL_IP 固定出口优先于访客 IP，非法值则忽略', () => {
  const original = process.env.NETEASE_REAL_IP
  try {
    process.env.NETEASE_REAL_IP = '119.145.10.20'
    assert.equal(resolveNeteaseOutboundIp('113.108.1.10'), '119.145.10.20')
    // 固定值对拿不到访客地址的请求同样生效（显式配置，不属于自动回退）
    assert.equal(resolveNeteaseOutboundIp('10.0.0.1'), '119.145.10.20')

    process.env.NETEASE_REAL_IP = 'not-an-ip'
    assert.equal(resolveNeteaseOutboundIp('113.108.1.10'), '113.108.1.10')
    assert.equal(resolveNeteaseOutboundIp('10.0.0.1'), undefined)
  } finally {
    if (original === undefined) delete process.env.NETEASE_REAL_IP
    else process.env.NETEASE_REAL_IP = original
  }
})

test('NETEASE_REAL_IP_MODE 默认开启，off 时整体关停', () => {
  const original = process.env.NETEASE_REAL_IP_MODE
  try {
    delete process.env.NETEASE_REAL_IP_MODE
    assert.equal(isNeteaseRealIpEnabled(), true)
    process.env.NETEASE_REAL_IP_MODE = 'off'
    assert.equal(isNeteaseRealIpEnabled(), false)
    process.env.NETEASE_REAL_IP_MODE = 'on'
    assert.equal(isNeteaseRealIpEnabled(), true)
  } finally {
    if (original === undefined) delete process.env.NETEASE_REAL_IP_MODE
    else process.env.NETEASE_REAL_IP_MODE = original
  }
})

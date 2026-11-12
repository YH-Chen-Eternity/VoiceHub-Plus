/**
 * VoiceHub-Plus — 非官方社群版（基於 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 雷池（SafeLine）只讀聚合的純常量／枚舉（無外部依賴，便於契約測試直接導入）。
 * 表名候選已按雷池 9.x 免費個人版實測校正（2026-11，生產庫 safeline-ce）。
 */

export type SafelineTimeMode = 'timestamp' | 'epochMs' | 'epochSec'

/** 候選表：攻擊偵測記錄（免費版在前，舊版攻擊事件表兜底）。 */
export const SL: {
  attackTables: string[]
  /** 帶 status_code 欄的舊版事件表（HTTP 流量回退統計專用；免費版 detect 表沒有該欄）。 */
  eventTables: string[]
  aggTables: string[]
  ipTables: string[]
  timeMode: SafelineTimeMode
  col: {
    time: string
    ip: string
    type: string
    status: string
    region: string
    host: string
  }
} = {
  attackTables: ['mgt_detect_log_basic', 'mgt_attack_log'],
  eventTables: ['mgt_attack_log'],
  aggTables: ['mgt_statistics_agg', 'statistics_basics'],
  ipTables: ['statistics_ips'],
  timeMode: 'epochSec',
  col: {
    time: 'timestamp',
    ip: 'src_ip',
    type: 'attack_type',
    status: 'status_code',
    region: 'country',
    host: 'host'
  }
}

/** 雷池官方 AttackType 枚舉（chaitin/safeline detectlog.go），未列出的碼回退「類型 N」。 */
export const SAFELINE_ATTACK_TYPES: Record<number, string> = {
  [-4]: '超长数据',
  [-3]: '黑名单',
  [-2]: '白名单',
  [-1]: '非攻击',
  0: 'SQL 注入',
  1: 'XSS',
  2: 'CSRF',
  3: 'SSRF',
  4: '拒绝服务',
  5: '后门',
  6: '反序列化',
  7: '代码执行',
  8: '代码注入',
  9: '命令注入',
  10: '文件上传',
  11: '文件包含',
  12: '重定向',
  13: '权限不当',
  14: '信息泄露',
  15: '未授权访问',
  16: '不安全的配置',
  17: 'XXE',
  18: 'XPath 注入',
  19: 'LDAP 注入',
  20: '目录穿越',
  21: '扫描器',
  22: '水平权限绕过',
  23: '垂直权限绕过',
  24: '文件修改',
  25: '文件读取',
  26: '文件删除',
  27: '逻辑错误',
  28: 'CRLF 注入',
  29: '模板注入',
  30: '点击劫持',
  31: '缓冲区溢出',
  32: '整数溢出',
  33: '格式化字符串',
  34: '条件竞争',
  35: 'HTTP 协议违规',
  61: '超时',
  62: '未知',
  63: '威胁情报',
  64: 'Cookie 篡改'
}

/** 常見 ISO 國家碼 → 中文名（detect 表 region 為碼值；未收錄的原樣展示）。 */
export const SAFELINE_COUNTRY_NAMES: Record<string, string> = {
  CN: '中国',
  HK: '中国香港',
  MO: '中国澳门',
  TW: '中国台湾',
  US: '美国',
  JP: '日本',
  KR: '韩国',
  SG: '新加坡',
  DE: '德国',
  GB: '英国',
  FR: '法国',
  RU: '俄罗斯',
  CA: '加拿大',
  AU: '澳大利亚',
  IN: '印度',
  BR: '巴西',
  NL: '荷兰',
  VN: '越南',
  TH: '泰国',
  MY: '马来西亚',
  ID: '印度尼西亚',
  PH: '菲律宾',
  UA: '乌克兰',
  TR: '土耳其',
  IT: '意大利',
  ES: '西班牙',
  SE: '瑞典',
  CH: '瑞士',
  NZ: '新西兰',
  MX: '墨西哥',
  AR: '阿根廷',
  ZA: '南非',
  AE: '阿联酋',
  SA: '沙特阿拉伯',
  IL: '以色列',
  PL: '波兰',
  IR: '伊朗',
  PK: '巴基斯坦',
  BD: '孟加拉国',
  NG: '尼日利亚',
  EG: '埃及'
}

import { toSimplifiedChinese } from '../song-name-normalize.ts'

/**
 * 歌词正文归一化：仅用于跨来源一致性比较。
 *
 * 先做繁→简统一，避免同一首歌在网易云（简体）与 QQ 音乐（繁体）之间被判定为内容不一致；
 * 再统一 NFKC、转小写、去掉标点与空白。纯函数，无解析器依赖，便于单测。
 */
export const normalizeLyricText = (text: string): string =>
  toSimplifiedChinese(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')

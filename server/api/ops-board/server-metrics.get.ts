/**
 * 主機指標。資料源：/data/voicehub/host-metrics/ 檔案（格式見 hostMetrics.ts 頂部）。
 * 目錄未掛載或檔案不存在時由 readHostMetrics 回傳 available:false，不拋錯。
 */
import { defineEventHandler } from 'h3'
import { requireOpsBoardViewer } from '~~/server/utils/opsBoardViewer'
import { readHostMetrics } from '~~/server/utils/hostMetrics'
import { parseOpsRange, setOpsBoardNoStore } from './_shared'

export default defineEventHandler(async (event) => {
  await requireOpsBoardViewer(event)
  setOpsBoardNoStore(event)

  const info = parseOpsRange(event)
  return readHostMetrics(info.range, info.startTime)
})

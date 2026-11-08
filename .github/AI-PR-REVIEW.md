# AI 自动审查 PR

本仓库配置了 PR 自动代码审查：每次 PR 有新的改动时，由大模型阅读 diff，并在 PR 下发布（或原地更新）一条分级审查意见。

- 工作流文件：[`.github/workflows/ai-pr-review.yml`](workflows/ai-pr-review.yml)
- 调用方式：**任意 OpenAI 兼容的 `/chat/completions` 端点**，厂商可随时更换，无需改代码
- 凭据：一个 `AI_REVIEW_API_KEY` Secret；厂商地址与模型名放在两个普通变量里

> 说明：平台内置的免费模型推理服务已于 2026-07-30 退役，其推理接口现在只返回纯文本，无法用于审查。因此本工作流改为走标准的 OpenAI 兼容接口。多家厂商提供**不花钱、无需信用卡**的免费额度，见第三节。

## 一、快速启用

只需三步，其中第 1 步是唯一需要人工操作的部分。

1. **申请一把免费的 API Key**（见第三节任选一家，最常见的是 Google AI Studio：`https://aistudio.google.com/app/apikey` → Get API key）。这把 Key 不产生费用，建议单独申请、只用于本仓库，用完可在厂商后台删除。
2. **填入仓库 Secret**：`Settings → Secrets and variables → Actions → Secrets → New repository secret`
   - Name：`AI_REVIEW_API_KEY`
   - Value：上一步拿到的 Key
3. **手动触发验证**：`Actions → AI PR Review → Run workflow` → 填任一开放 PR 的编号 → 运行。成功时该 PR 下出现一条以「AI 代码审查」开头的评论，日志末尾有 `已发布审查评论`。

`AI_REVIEW_BASE_URL` 与 `AI_REVIEW_MODEL` 两个变量已按推荐方案在仓库里预置好，通常不用动。想换厂商时，改这两个变量即可，不需要改工作流文件。

## 二、配置项

| 类型 | 名称 | 作用 | 是否必填 |
| --- | --- | --- | --- |
| Secret | `AI_REVIEW_API_KEY` | 推理接口的 Bearer Key | **必填**，不填则审查步骤显示为 skipped |
| Variable | `AI_REVIEW_BASE_URL` | OpenAI 兼容端点的**基地址**，不含 `/chat/completions` | 必填（已预置） |
| Variable | `AI_REVIEW_MODEL` | 模型 ID | 必填（已预置） |

工作流会自动把基地址末尾的斜杠去掉，再拼上 `/chat/completions`。例如基地址填 `https://generativelanguage.googleapis.com/v1beta/openai`，实际请求 `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`。

**配置不齐时的行为**：`检查审查配置` 这一步会把审查步骤置为 `skipped`，并在日志里用 warning 明确列出缺了哪几项，不会出现「运行显示成功、PR 上却什么都没有」而查不到原因的情况。

## 三、可选的免费推理来源

以下端点都遵循 OpenAI 的 `chat/completions` 请求/响应格式，只要把 `AI_REVIEW_BASE_URL` 和 `AI_REVIEW_MODEL` 改成对应值就能用。模型 ID 与免费额度会随厂商调整，**以厂商官方页面为准**；若日志提示 `HTTP 404` 模型不存在，改一下 `AI_REVIEW_MODEL` 即可。

| 来源 | `AI_REVIEW_BASE_URL` | 示例 `AI_REVIEW_MODEL` | 申请地址 | 免费情况 |
| --- | --- | --- | --- | --- |
| Google Gemini（OpenAI 兼容） | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | `https://aistudio.google.com/app/apikey` | 有免费层，按请求数/分钟限额 |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/<账户ID>/ai/v1` | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | `https://dash.cloudflare.com` → API Tokens | 每天有免费额度，无需信用卡；Token 需带 Workers AI 权限 |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` | `https://console.groq.com/keys` | 有免费层 |
| OpenRouter | `https://openrouter.ai/api/v1` | 带 `:free` 后缀的模型 | `https://openrouter.ai/keys` | 部分模型免费 |
| Cerebras | `https://api.cerebras.ai/v1` | `llama3.1-8b` | `https://cloud.cerebras.ai` | 有免费层 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | `https://open.bigmodel.cn` | 部分 Flash 模型免费 |
| OpenAI / DeepSeek | `https://api.openai.com/v1` / `https://api.deepseek.com/v1` | `gpt-4o-mini` / `deepseek-chat` | 各自控制台 | 按量付费，非免费 |

> 提示：换用推理更强或上下文更长的模型时，可同步下调工作流里的 `MAX_PATCH_CHARS`。

## 四、触发时机

| 触发方式 | 说明 |
| --- | --- |
| PR 新建 / 重新打开 | 自动审查 |
| PR 推送新提交 | 自动重新审查，并**更新同一条评论**（不会刷屏） |
| 草稿转正式 | 自动审查（草稿状态跳过） |
| 手动触发 | Actions → `AI PR Review` → `Run workflow`，填写 PR 编号 |

自动触发使用 `pull_request_target`，这样来自 fork 分支和自动化依赖更新的 PR 也能正常写评论。安全性见下一节。

## 五、安全设计

| 措施 | 说明 |
| --- | --- |
| 不执行 PR 代码 | 工作流**不 checkout、不安装依赖、不运行任何来自 PR 的脚本**，只通过 API 读取 diff 纯文本。工作流脚本本身来自默认分支，不受 PR 内容影响 |
| 最小权限 | 仅 `contents: read`、`pull-requests: write`、`issues: write`；无写源码权限 |
| 密钥不落地 | Key 只存在于 Actions Secret 与运行时环境变量中，不写进代码、日志、PR 评论；检查步骤只判断值是否为空，不回显内容 |
| 防提示注入 | 系统提示明确把 PR 标题与 diff 定性为「待审查数据」，要求模型忽略其中改变角色、索取凭据、执行命令、外链跳转等指令 |
| 输出受限 | 模型输出截断到 6000 字符，评论里只写审查意见与日志链接 |
| 失败不阻塞 | 推理超时、限流、返回异常时只记录 warning 并正常结束，**不会让 PR 的检查项变红**；日志里会带上 HTTP 状态与响应原文片段，便于定位 |
| 幂等 | 用隐藏标记识别既有评论并原地更新；同一 PR 的并发运行由 `concurrency` 组自动取消旧任务 |

> AI 审查只是辅助，不替代人工评审，也不作为合并的强制门禁。

## 六、可调参数

常规调整**不需要改代码**，在 `Settings → Secrets and variables → Actions → Variables` 里改即可（见第二节）。需要改审查行为时，编辑工作流 `script` 顶部的常量：

| 常量 | 作用 | 默认值 |
| --- | --- | --- |
| `MAX_FILES` | 单次最多送审文件数 | `30` |
| `MAX_PATCH_CHARS` | 送审 diff 总字符上限 | `16000` |
| `SKIP` | 跳过的文件（锁文件、压缩资源、二进制等） | 见文件 |
| `SYSTEM` | 审查规则与输出格式 | 见文件 |

## 七、验证与排障

手动触发一次即可验证整条链路。成功标志：PR 下出现「AI 代码审查」评论，日志里有 `已发布审查评论` 或 `已更新既有审查评论`。

| 现象 | 排查方向 |
| --- | --- |
| 审查步骤显示 `skipped` | 看 `检查审查配置` 的 warning，按提示补齐 Secret / Variables |
| 评论没出现，日志有 `AI 审查未生成` | 日志已附上具体原因：HTTP 401/403 是 Key 无效或权限不足；429 是免费额度用尽；404 是模型 ID 不对（改 `AI_REVIEW_MODEL`）；「返回的不是 JSON」是基地址填错 |
| 评论没出现，日志有 `没有可审查的文本改动` | 该 PR 只改了锁文件、图片等被跳过的文件，属正常行为 |
| 想临时停用 | 在 Actions 页面禁用该工作流，或直接删除 `AI_REVIEW_API_KEY` Secret |
| 想彻底移除 | 删除 `.github/workflows/ai-pr-review.yml` 与本文档，并手动删除历史审查评论 |

## 八、已知限制

- 大模型看不到未改动的上下文文件，只能依据 diff 判断，可能漏掉跨文件的隐含问题。
- 超大 PR 会按上限截断，评论底部会标注实际送审文件数。
- 生成结果可能有误报，请人工复核后再决定是否修改代码。
- 免费额度由所选厂商按其账号维度计算，用尽时工作流只记 warning，不影响 PR。

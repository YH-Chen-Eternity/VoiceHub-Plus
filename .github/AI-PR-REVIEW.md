# AI 自动审查 PR

本仓库配置了 PR 自动代码审查：每次 PR 有新的改动时，由大模型阅读 diff，并在 PR 下发布（或原地更新）一条分级审查意见。

- 工作流文件：[`.github/workflows/ai-pr-review.yml`](workflows/ai-pr-review.yml)
- 推理来源：**首选 + 备用**两级，均为标准 OpenAI 兼容 `/chat/completions` 端点，厂商可随时更换
- 当前接入：首选 NVIDIA（`deepseek-ai/deepseek-v4.1-flash`），备用 GLM（`glm-4.7-flash`），两者都有免费额度
- 失败策略：首选失败自动切备用；两级都失败时**等待 10 分钟整体重试一轮**，仍失败则记录警告并正常结束，不会让 PR 检查变红

## 一、配置清单

Secret 与变量都在 `Settings → Secrets and variables → Actions` 里维护。**首选、备用至少配置一个**，工作流即可运行。

| 类型 | 名称 | 作用 | 现状 |
| --- | --- | --- | --- |
| Secret | `AI_REVIEW_NVAPI_KEY` | 首选来源的 Bearer Key | 已配置 |
| Secret | `AI_REVIEW_API_KEY` | 备用来源的 Bearer Key | 已配置 |
| Variable | `AI_REVIEW_BASE_URL` | 备用端点基地址（不含 `/chat/completions`） | `https://open.bigmodel.cn/api/paas/v4` |
| Variable | `AI_REVIEW_MODEL` | 备用模型 ID | `glm-4.7-flash` |
| Variable | `AI_REVIEW_NV_BASE_URL` | 可选，覆盖首选端点地址 | 默认 `https://integrate.api.nvidia.com/v1` |
| Variable | `AI_REVIEW_NV_MODEL` | 可选，覆盖首选模型 ID | 默认 `deepseek-ai/deepseek-v4.1-flash` |
| Variable | `AI_REVIEW_RETRY_WAIT_MS` | 可选，两级都失败后的重试等待毫秒数 | 默认 `600000`（10 分钟） |

密钥用仓库公钥加密写入 Secret，不进代码、日志与评论；检查步骤只判断值是否为空，不回显。

**配置不齐时的行为**：`检查审查配置` 会把审查步骤置为 `skipped`，并在日志里用 warning 明确列出缺了哪几项，不会出现「运行显示成功、PR 上却什么都没有」而查不到原因的情况。

## 二、免费 Key 从哪里来

| 来源 | 申请地址 | 说明 |
| --- | --- | --- |
| NVIDIA（首选） | `https://build.nvidia.com` | 开发者账号自带免费调用额度；模型目录里有 `deepseek-ai/deepseek-v4.1-flash`，额度以官方页面为准 |
| 智谱 GLM（备用） | `https://open.bigmodel.cn` | Flash 档免费，高峰期可能返回 429 限流 |
| 其他可换厂商 | 见下方对照 | 均兼容 OpenAI 格式，改两个 Variable 即可切换 |

其他兼容端点：Google Gemini `https://generativelanguage.googleapis.com/v1beta/openai`、Cloudflare Workers AI `https://api.cloudflare.com/client/v4/accounts/<账户ID>/ai/v1`、Groq `https://api.groq.com/openai/v1`、OpenRouter `https://openrouter.ai/api/v1`、Cerebras `https://api.cerebras.ai/v1`。模型 ID 与免费额度随厂商调整，**以厂商官方页面为准**。

## 三、触发时机

| 触发方式 | 说明 |
| --- | --- |
| PR 新建 / 重新打开 | 自动审查 |
| PR 推送新提交 | 自动重新审查，并**更新同一条评论**（不会刷屏） |
| 草稿转正式 | 自动审查（草稿状态跳过） |
| 手动触发 | Actions → `AI PR Review` → `Run workflow`，填写 PR 编号 |

自动触发使用 `pull_request_target`，这样来自 fork 分支和自动化依赖更新的 PR 也能正常写评论。安全性见下一节。

## 四、安全设计

| 措施 | 说明 |
| --- | --- |
| 不执行 PR 代码 | 工作流**不 checkout、不安装依赖、不运行任何来自 PR 的脚本**，只通过 API 读取 diff 纯文本。工作流脚本本身来自默认分支，不受 PR 内容影响 |
| 最小权限 | 仅 `contents: read`、`pull-requests: write`、`issues: write`；无写源码权限 |
| 密钥不落地 | 两把 Key 只存在于 Actions Secret 与运行时环境变量中，不写进代码、日志、PR 评论 |
| 防提示注入 | 系统提示明确把 PR 标题与 diff 定性为「待审查数据」，要求模型忽略其中改变角色、索取凭据、执行命令、外链跳转等指令 |
| 输出受限 | 模型输出截断到 6000 字符，评论里只写审查意见、实际使用的来源与日志链接 |
| 失败不阻塞 | 来源失败逐条记录原因（来源 + HTTP 状态 + 响应片段），重试后仍失败只记 warning，**不会让 PR 的检查项变红** |
| 幂等 | 用隐藏标记识别既有评论并原地更新；同一 PR 的并发运行由 `concurrency` 组自动取消旧任务（含重试等待中的旧任务） |

> AI 审查只是辅助，不替代人工评审，也不作为合并的强制门禁。

## 五、验证与排障

手动触发：Actions → `AI PR Review` → `Run workflow` → 填 PR 编号。成功标志：PR 下出现/更新「AI 代码审查」评论，评论底部会标注本次实际使用的来源。

| 现象 | 排查方向 |
| --- | --- |
| 审查步骤 `skipped` | 看 `检查审查配置` 的 warning，按提示补齐 Secret / Variables |
| 评论没出现，日志有来源失败记录 | 每条都带 HTTP 状态：401/403 是对应 Key 无效；429 是免费额度/限流；404 是模型 ID 不对（改对应 Variable）；「返回的不是 JSON」是基地址填错 |
| 日志出现「等待后重试」 | 两级来源首轮都失败，属预期行为；10 分钟后自动重试，也可手动重跑 |
| 评论没出现，日志有 `没有可审查的文本改动` | 该 PR 只改了锁文件、图片等被跳过的文件，属正常行为 |
| 想临时停用 | 删除两个 Key 的 Secret（审查步骤会 skipped 并说明原因），或在 Actions 页禁用工作流 |
| 想彻底移除 | 删除 `.github/workflows/ai-pr-review.yml` 与本文档，并手动删除历史审查评论 |

## 六、已知限制

- 大模型看不到未改动的上下文文件，只能依据 diff 判断，可能漏掉跨文件的隐含问题。
- 超大 PR 会按上限截断，评论底部会标注实际送审文件数。
- 生成结果可能有误报，请人工复核后再决定是否修改代码。
- 免费额度由所选厂商按其账号维度计算；两级来源都限流时，重试一轮后放弃，不影响 PR。
- 重试等待期间该运行会占用约 10 分钟执行时长，公开仓库免费额度充足；新提交会自动取消等待中的旧运行。

# AI 自动审查 PR

本仓库配置了 PR 自动代码审查：每次 PR 有新的改动时，由大模型阅读 **diff + 被改文件在 PR head 版本的完整内容**，并在 PR 下发布（或原地更新）一条分级审查意见。完整内容让模型能结合上下文核对调用链、类型与边界，减少只看片段造成的误报。

- 工作流文件：[`.github/workflows/ai-pr-review.yml`](workflows/ai-pr-review.yml)
- 推理来源：**首选 + 备用**两级，均为标准 OpenAI 兼容 `/chat/completions` 端点，厂商可随时更换
- 当前接入：首选 NVIDIA（`nvidia/nemotron-3-ultra-550b-a55b`），备用 GLM（`glm-4.7-flash`），两者都有免费额度
- 失败策略：首选失败（含挂起，单次请求 90 秒封顶）自动切备用；两级都失败时**等待 10 分钟整体重试一轮**，仍失败则记录警告并正常结束，不会让 PR 检查变红

## 一、配置清单

Secret 与变量都在 `Settings → Secrets and variables → Actions` 里维护。**NVIDIA Key、GLM Key 至少配置一个**，工作流即可运行。

| 类型 | 名称 | 作用 | 现状 |
| --- | --- | --- | --- |
| Secret | `AI_REVIEW_NVAPI_KEY` | 首选来源的 Bearer Key | 已配置 |
| Secret | `AI_REVIEW_API_KEY` | 备用来源的 Bearer Key | 已配置 |
| Variable | `AI_REVIEW_BASE_URL` | 备用端点基地址（不含 `/chat/completions`） | `https://open.bigmodel.cn/api/paas/v4` |
| Variable | `AI_REVIEW_MODEL` | 备用模型 ID | `glm-4.7-flash` |
| Variable | `AI_REVIEW_NV_BASE_URL` | 可选，覆盖首选端点地址 | 默认 `https://integrate.api.nvidia.com/v1` |
| Variable | `AI_REVIEW_NV_MODEL` | 可选，覆盖首选模型 ID | 默认 `nvidia/nemotron-3-ultra-550b-a55b` |
| Variable | `AI_REVIEW_RETRY_WAIT_MS` | 可选，两级都失败后的重试等待毫秒数 | 默认 `600000`（10 分钟） |

密钥用仓库公钥加密写入 Secret，不进代码、日志与评论；检查步骤只判断值是否为空，不回显。

**配置不齐时的行为**：`检查审查配置` 会把审查步骤置为 `skipped`，并在日志里用 warning 明确列出缺了哪几项，不会出现「运行显示成功、PR 上却什么都没有」而查不到原因的情况。

## 二、免费 Key 从哪里来

| 来源 | 申请地址 | 说明 |
| --- | --- | --- |
| NVIDIA（首选） | `https://build.nvidia.com` | 开发者账号自带免费调用额度；实测 `nvidia/nemotron-3-ultra-550b-a55b` 响应稳定（约 1 秒）。注意其目录里的 DeepSeek 系模型（`deepseek-ai/deepseek-v4.1-flash`）服务端长期挂起无响应，勿选用 |
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
| 不执行 PR 代码 | 工作流**不 checkout、不安装依赖、不运行任何来自 PR 的脚本**，只通过 API 读取 diff 与被改文件在 head 版本的完整内容（纯文本）。工作流脚本本身来自默认分支，不受 PR 内容影响；读到的内容只作为待审查数据拼进提示词，不参与命令拼接或执行 |
| 最小权限 | 仅 `contents: read`（读取被改文件所必需）、`pull-requests: write`、`issues: write`；无 `contents: write`，无法改动源码 |
| 密钥不落地 | 两把 Key 只存在于 Actions Secret 与运行时环境变量中，不写进代码、日志、PR 评论 |
| 防提示注入 | 系统提示明确把 PR 标题、描述、diff 与所附文件内容一并定性为「待审查数据」，要求模型忽略其中改变角色、索取凭据、执行命令、外链跳转等指令 |
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
| 日志里「附完整内容 0 / 读取失败 N」 | 多为二进制、超大 blob 或新增文件无 blob sha 被跳过；diff 仍正常送审，不影响审查结论 |
| 想临时停用 | 删除两个 Key 的 Secret（审查步骤会 skipped 并说明原因），或在 Actions 页禁用工作流 |
| 想彻底移除 | 删除 `.github/workflows/ai-pr-review.yml` 与本文档，并手动删除历史审查评论 |

## 六、送审内容与上下文读取

审查材料不止 diff。工作流对每个改动文件额外读取**该文件在 PR head 版本的完整内容**（带行号）一并送审，让模型能核对函数调用、类型定义、状态流转与边界条件，避免仅凭 diff 片段误判「未实现」「缺少校验」。

| 项 | 说明 |
| --- | --- |
| 读取方式 | 用 `pulls.listFiles` 返回的 blob sha 调 `git.getBlob`；失败时回退 `repos.getContent?ref=head.sha`。两条通道对 **fork PR** 同样可用（PR head 对象存于 base 仓库，已实测） |
| 所需权限 | `contents: read`——Git Data API 依赖它；不授予 `contents: write`，工作流无法写源码 |
| 小文件 | 单文件 ≤ `MAX_FILE_FULL_CHARS`（16000 字符）附完整内容，带行号 |
| 大文件 | 超阈值时解析 diff 的 hunk 行号，围绕改动行取 ±`CONTEXT_LINES`（30）行，合并重叠窗口后附「改动区域上下文」，同样带行号。实测 82KB / 3430 行的 `SongList.vue` 压缩到约 12KB（14.7%），5 个窗口精确覆盖 5 处改动 |
| 总预算 | 附加内容合计 ≤ `MAX_CONTEXT_CHARS`（64000 字符）；diff 仍受 `MAX_PATCH_CHARS`（24000）约束。二者分别计数、互不影响 |
| 跳过 | `removed` 文件、锁文件、二进制、解码含空字符、以及 blob 读取失败的文件；日志与评论底部都会标注实际附加数量 |

参数集中在工作流脚本顶部常量，可按需调整；增大预算会提高模型调用成本，但不影响 `max_tokens`（仅约束输出）。四反引号围栏可避免文件内容里的代码块截断送审文本。

## 七、已知限制

- 能看到**被改文件**的完整内容/改动区域上下文，但看不到**未被改动**的其它文件（依赖模块、类型定义、配置文件等），跨文件隐含问题仍可能漏掉。
- 超大 PR 按文件数与字符预算截断；单个大文件改为改动区域上下文。评论底部会标注实际送审文件数与附加上下文的文件数。
- 生成结果可能有误报，请人工复核后再决定是否修改代码。
- 免费额度由所选厂商按其账号维度计算；两级来源都限流/失败时，重试一轮后放弃，不影响 PR。
- 重试等待期间该运行会占用约 10 分钟执行时长，公开仓库免费额度充足；新提交会自动取消等待中的旧运行。

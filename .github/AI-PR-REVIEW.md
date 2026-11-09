# AI 自动审查 PR

本仓库配置了 PR 自动代码审查：每次 PR 有新的改动时，由大模型阅读 **diff + 被改文件在 PR head 版本的完整内容 + 按 import 引用带出的未改动关联文件 +（涉及 UI 时）项目规范锚点**，并在 PR 下发布（或原地更新）一条分级审查意见。完整内容与跨文件、规范锚点让模型能核对调用链、类型定义、状态流转、设计统一性与双语适配，减少只看 diff 片段造成的误报。

- 工作流文件：[`.github/workflows/ai-pr-review.yml`](workflows/ai-pr-review.yml)
- 推理来源：**首选 + 备用**两级，均为标准 OpenAI 兼容 `/chat/completions` 端点，厂商可随时更换；按上下文容量**分级送审**（首选走全量、备用走精简，见第六节）
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
| 不执行 PR 代码 | 工作流**不 checkout、不安装依赖、不运行任何来自 PR 的脚本**，只通过 API 递归读取 head 版本仓库树、diff、被改文件与关联文件的完整内容、以及项目规范锚点文件（均为纯文本）。工作流脚本本身来自默认分支，不受 PR 内容影响；读到的内容只作为待审查数据拼进提示词，不参与命令拼接或执行 |
| 最小权限 | 仅 `contents: read`（读取被改文件所必需）、`pull-requests: write`、`issues: write`；无 `contents: write`，无法改动源码 |
| 密钥不落地 | 两把 Key 只存在于 Actions Secret 与运行时环境变量中，不写进代码、日志、PR 评论 |
| 防提示注入 | 系统提示明确把 PR 标题、描述、diff 与所附的全部文件内容（含关联文件与规范锚点）一并定性为「待审查数据」，要求模型忽略其中改变角色、索取凭据、执行命令、外链跳转等指令 |
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
| 日志「附完整内容/上下文 N、关联 M、锚点 K」 | 全量模式（首选 nvidia）统计；精简模式（备用 glm）不带关联/锚点属正常，非故障 |
| 涉及 UI 的 PR 却没有 UI 专项结论 | 首选来源失败回退到精简模式时会跳过 UI 专项（无锚点材料）；看评论底部「来源」是否为备用，恢复首选即可 |
| 想临时停用 | 删除两个 Key 的 Secret（审查步骤会 skipped 并说明原因），或在 Actions 页禁用工作流 |
| 想彻底移除 | 删除 `.github/workflows/ai-pr-review.yml` 与本文档，并手动删除历史审查评论 |

## 六、送审内容与分级策略

审查材料不止 diff。首选来源（NVIDIA，1M 上下文）走**全量**，把该带的都带齐；备用来源（GLM，上下文较小）自动降级到**精简**，避免超长输入把兜底链路打挂。两级由 provider 的 `tier` 决定，切换无需人工干预。

| 材料 | 全量（首选 nvidia，1M） | 精简（备用 glm） |
| --- | --- | --- |
| 改动文件 | diff（不截断）+ **完整内容**（带行号，不聚焦） | diff + 完整内容/超长时 ±30 行改动区域上下文 |
| 跨文件关联 | **按 import 带出未改动的关联文件全文**（见第七节） | 不带 |
| UI 规范锚点 | 涉及 UI 时附 **AGENTS.md + 双词典 + 全局 CSS + Icon/CustomSelect/AppSpinner + 同类组件**（见第七节） | 不带 |
| 输出长度 | ≤ 1500 字 | ≤ 900 字 |
| 体积上限 | `MAX_FULL_CHARS` = 2,400,000 字符（防呆，远低于 1M token 容量） | `MAX_CONTEXT_CHARS` = 64,000 + `MAX_PATCH_CHARS` = 24,000 |

**读取通道**：用 `git.getTree(recursive=1)` 拿 head 版本完整仓库树（含 fork PR，已实测），再用 `pulls.listFiles` 的 blob sha 调 `git.getBlob` 读文件全文，失败回退 `repos.getContent?ref=head.sha`。所需权限仍是 `contents: read`，不授予写权限。

**典型体积**：一个改动 `SongList.vue` 的 UI PR，实测 15/15 条本地 import 全部解析命中；全量送审约 90 万字符（改动文件 80KB + 关联文件 161KB + UI 锚点 571KB〔含 2 个 locale 各约 270KB〕+ 同类组件 75KB）≈ 26 万 token，远低于 1M 上下文与 2.4M 字符上限。四反引号围栏避免文件内容里的代码块截断送审文本。

参数集中在脚本顶部常量，可按需调整；预算只约束输入，不影响 `max_tokens`（仅约束输出）。

## 七、跨文件关联与 UI 专项审查

### 跨文件关联

模型此前只能看到**被改文件**，看不到它依赖却本次未改动的模块、类型、composable、配置，容易误判「未实现」「缺少校验」。现在解析每个改动文件全文里的 `import` / `require` / 动态 import / `export ... from`，把**本地引用**映射到 head 仓库树的真实文件一并带上：

| 项 | 说明 |
| --- | --- |
| 别名 | `~/` → `app/`、`~~/` → 仓库根、`@/` → `app/` 或根、相对路径按被改文件所在目录归一；逐一补 `.ts/.vue/.js/.mjs/.json` 与 `/index.*` 扩展名 |
| 外部包 | `vue` / `h3` 等无法映射到仓库树的自动跳过，不会报错 |
| 上限 | `MAX_RELATED_FILES` = 24 个关联文件、`MAX_PEER_COMPONENTS` = 6 个同类组件；按与改动文件的相关度取用，日志与评论底部标注实际附加数 |

伴随 SYSTEM 的「跨文件核对」条款：据此确认被调用的函数/类型/常量确实存在、签名匹配、导入路径有效，不因「diff 里没看到实现」就报未实现，也不臆测材料中完全没有的其它文件。

### UI 改动专项审查

当 PR 涉及 `.vue`、前端样式、`app/components|pages|layouts`、`app/assets/css`、`app/utils/locale` 或 `uno.config.*` 时，自动附带**项目规范锚点**并启用专项检查。锚点取自仓库真实约定（`AGENTS.md`），不是通用条款：

- `AGENTS.md`（权威规范）、`app/assets/css/main.css` + `components.css`（CSS 变量/全局重置）、`app/utils/locale/zh-CN.ts` + `en-US.ts`（双词典）、`Icon.vue` / `CustomSelect.vue` / `AppSpinner.vue`（点名复用组件）、`app/components/UI/Common/` 下同类组件。
- 专项检查四条：**设计统一**（`<script setup>` 纯 JS、自定义组件显式导入、`<Icon name>` 有定义、下拉统一 `CustomSelect.vue`、加载统一 `AppSpinner.vue`、CSS 变量/scoped/UnoCSS 不混用、全局 border 重置勿删）；**交互逻辑合理**（响应式数组不被原地 `sort()`、watch/computed 配合、切换筛选/排序重置页码、异步配置 `v-if="loaded"` 防 SSR 闪烁、移动端/桌面端两套控件一致）；**双语适配**（zh/en 词典结构完全一致、新增键两文件同步、`useLocale()` 分区取值、禁止硬编码文案、服务端错误码三处键对齐、文案用简洁陈述句）；**与项目统一**（优先复用既有组件、不破坏同类行为一致性）。
- 每条 UI 问题必须指出违反的具体规范条款。**无锚点材料（精简模式）时跳过本节**，不凭空套用。

## 八、已知限制

- 跨文件关联只跟随**被改文件里出现的 import 引用**，不做事后全仓依赖图遍历；未被任何改动文件 import、但逻辑上相关的文件仍可能漏掉。
- 关联文件与同类组件有数量上限（24 / 6），超大型 PR 会按相关度取用；评论底部会标注实际附加数。
- 备用来源（精简模式）不带跨文件与 UI 锚点、不启用 UI 专项；需要完整审查时以首选来源结果为准。
- 生成结果可能有误报，请人工复核后再决定是否修改代码。
- 免费额度由所选厂商按其账号维度计算；两级来源都限流/失败时，重试一轮后放弃，不影响 PR。
- 重试等待期间该运行会占用约 10 分钟执行时长，公开仓库免费额度充足；新提交会自动取消等待中的旧运行。

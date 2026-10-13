# 小说家 preset：长篇小说创作方案

本地创作的 Agent preset：专门的小说创作 Agent，工具链与发布版 `standard` 对齐（文件、Shell、检索、Skills、goal、子代理、工作流、压缩），叠加小说家身份、即开即用的立项访谈、六件套记忆系统和 TTS 友好的章节成稿规范。不限定模型：云端大模型与本地小模型都能用，纪律按窗口大小伸缩。

## 即开即用：立项访谈

用户一句话（如"写一部都市职场恋爱小说"）即可开工。agent 主动追问，两轮问清：

- **第一轮必问**（一次打包 5–6 题，每题第一个选项为推荐）：题材类型、目标读者与基调、篇幅节奏、叙事视角、文风、尺度走向
- **第二轮粒度**（一次打包 3–4 题，全部带推荐）：世界观写多细（完整设定集/一句话背景）、角色卡建几张（主角+配角全卡/出场再建）、大纲写多粗（全书粗纲+卷细纲/只卷纲）、自由度（即兴但回写/严格照纲）
- 细节粒度分三层：必问项用户拍板；默认项（单章字数、更新节奏等）不答即用推荐值；粒度项由用户选
- 产出**设定包**（世界观草案、角色卡、style-guide、大纲）并列出所有已采用的默认项，用户说"可以/直接开始"才写第一章

## 记忆系统（六件套 + 角色卡）

一部小说一个项目目录：

```
novels/<书名>/
├─ outline.md             # 分卷分弧大纲，每章一行提要 + 进度标记
├─ state.md               # 当前剧情（≤500 字，末尾是上一章结尾衔接句）
├─ summaries.md           # 章节摘要，每章一节，追加式
├─ arcs/arc-NN.md         # 弧简报（每章：目标、出场角色卡 id、伏笔编号、关键事件）
├─ memory/
│  ├─ worldview.md        # 世界观（规则、地理、势力、力量体系）
│  ├─ timeline.md         # 时间线（时间点 | 事件 | 涉及章节）
│  ├─ foreshadowing.md    # 伏笔台账（编号 | 埋设章节 | 内容 | 状态 | 回收章节）
│  ├─ characters.md       # 角色索引（id | 姓名 | 身份 | 状态）
│  └─ cards/<id>-<姓名>.md # 详细角色卡，一张卡一个文件
├─ style-guide.md         # 文风、用词、叙事视角、章节字数
└─ chapters/NNN-标题.md    # 一章一文件，纯文本正文
```

详细角色卡模板（基本信息 / 性格与说话 / 关系 / 人物弧线）与各台账的字段格式，见 `skills/novel-longform/SKILL.md`（按需加载）。

## 写作纪律（随模型大小伸缩）

- 动笔前读取范围按窗口伸缩：小窗口只读 `arcs/arc-NN.md` 本章条目 + `state.md` + 条目点名的角色卡；大窗口可按需补读相关台账
- 一章一次写完（默认 2000–4000 字，按 style-guide），一章一文件，纯文本
- 每章回写五件套：章节摘要 → 当前剧情 → 大纲进度 → 时间线 → 伏笔/角色卡/世界观增量，全部小步追加或局部编辑
- 并行能力：workflow 派子代理分头起草多章（主会话统一回写定稿）、subagent 派"编辑"审稿润色

## 长篇小说流水线

立项访谈 → 设定包确认 → 逐章写作与五件回写 → 修订。完整 SOP 与访谈清单在 `skills/novel-longform/SKILL.md`。

### 会话节奏（推荐）

- 新书：一个会话做完立项访谈 + 设定包确认
- 逐章：一或几章一个会话，上下文见长就 /compact 或开新会话
- 续写靠 `state.md` + `arcs/` + `outline.md`，换会话接得上；长篇连载用 goal 登记整体目标

## 可选：接入本地 Ollama 模型

写作时想切回台式机上的本地模型（如 3080 上的 9B），在本机 `$DSH_HOME/settings.yaml`（`/Users/canyu/.dsh/settings.yaml`）的现有 `llm-pi-ai: providers:` 字典下新增一条：

```yaml
ollama:
  apiKeyEnv: OLLAMA_API_KEY
  api: openai-completions
  baseURL: http://<台式机IP>:11434/v1
  models:
    - id: qwen3:9b          # 与台式机 ollama list 完全一致
      contextWindow: 8192    # 与台式机 OLLAMA_CONTEXT_LENGTH 一致
      maxTokens: 3072
      reasoningEfforts: false
```

- 台式机需设 `OLLAMA_CONTEXT_LENGTH=8192`（Ollama 默认往往只有 2K–4K），建议同时设 `OLLAMA_NUM_PARALLEL=1`
- 启动 GUI 的终端里 `export OLLAMA_API_KEY=sk-local`（占位即可）
- 保存后在模型选择器选 `ollama / qwen3:9b` 即生效，无需重启；其他会话保留各自模型
- 排错：`MISSING_CREDENTIAL` 补密钥；`UNKNOWN_MODEL` 核对模型 id；写到一半截断检查 `OLLAMA_CONTEXT_LENGTH`

## 有声化预留

章节文件是可直接朗读的纯文本，接入 TTS 时无需清洗正文；`summaries.md` 可直接当每集简介。将来有声化有两种扩展方式，都不必改动章节文件：在本目录 `skills/` 下新增配音技能；或在 `agent.cordis.yml` 追加包装 TTS CLI 的工具行（bash 已保留）。

## 修改本 preset

本目录是本地副本，可随意编辑。改完 `agent.cordis.yml` 后重开一个"小说家"会话验证；改坏时可删除本目录后重新 `copy()`。

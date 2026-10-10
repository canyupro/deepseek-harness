---
description: "团队自有的 teammate 子 LLM 路由：两层设置、固定编制与按名字的预设。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-agent-team-llm-settings

[English](README.md) | 中文

## 概述

`agent-team-llm-settings` 决定 Agent Teams 的 teammate 可以跑在哪些 LLM 路由上，以及 Lead 可以创建哪些 teammate。设置来自两层。全局层是用户设置文档覆盖在部署基底之上，通过 `current()` 读取。工作区层是 `<projectRoot>/.dsh/team.json`，从会话工作目录逐级向上找到最近的含 `.git` 的祖先目录即得。找不到项目根就没有工作区层，此时全局值原样生效。

`resolveFor(workspaceRoot)` 逐字段合并两层：工作区文档声明过的字段取胜，其余字段保留全局值。`members` 例外，它按名字合并：全局编制为基底，工作区里同名的成员整体替换全局那一条，全局没有的名字追加在后面；工作区未声明 `members` 时全局编制原样保留。启用状态的结果必须自洽：至少一条允许路由，且每个预设与默认路由都落在该清单内；停用状态的结果不生效。每条路由都会在创建任何 teammate 之前对运行中的 LLM adapter 校验，因此无法解析的 provider、model 或 reasoning effort 会让该调用失败，且不消耗 teammate 名称。

工作区文档是一份 version 1 的 JSON 文件，校验严格程度与线上请求相同，全局编制同样如此：未知字段、version 不为 1、只给一半的路由、不符合小写连字符格式的成员名、重复的名字、名为 `lead` 的成员，以及超过配置上限的编制，都会带着指名字段或成员的报错被拒绝。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把本服务与 `@deepseek-ai/dsh-experimental-agent-team`、`@deepseek-ai/dsh-experimental-tool-agent-team` 一起挂载。`@deepseek-ai/dsh-experimental-agent-team-profile` 已经挂载了它。

```yaml
- id: agent-team-llm-settings
  name: '@deepseek-ai/dsh-experimental-agent-team-llm-settings'
  config:
    enabled: true
    maxMembers: 8
    allowedRoutes:
      - provider: deepseek-official
        model: deepseek-v4-flash
      - provider: commandcode
        model: deepseek/deepseek-v4.1-flash
    defaultProvider: deepseek-official
    defaultModel: deepseek-v4-flash
    roleRoutes:
      - name: recon
        provider: deepseek-official
        model: deepseek-v4-flash
    members:
      - name: recon
        description: Maps the tree before anything changes.
        prompt: Start by reading the repository layout.
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `false` | 配置的路由是否生效 |
| `allowedRoutes` | `[]` | teammate 可以被路由到的精确路由 |
| `defaultProvider` | `''` | 名字与调用方都未指定时所用路由的 provider |
| `defaultModel` | `''` | 名字与调用方都未指定时所用路由的 model |
| `roleRoutes` | `[]` | 按 teammate 名字的预设路由 |
| `members` | `[]` | 未声明 `members` 的工作区所继承的固定编制 |
| `maxMembers` | `8` | 任一层中编制条目的上限 |

`enabled`、`allowedRoutes`、`roleRoutes` 与 `members` 属于用户自有设置；通过设置文档的修改会覆盖部署基底。

`spawn_teammate` 按以下顺序解析一个 teammate 的路由：

1. 调用中给出的 `provider`、`model` 与 `reasoning_effort`
2. `name` 等于该 teammate 名字的 `roleRoutes` 预设
3. 配置的默认路由（`defaultProvider` 与 `defaultModel` 都已设置时）
4. 设置停用或未指定任何路由时，继承 Lead 的路由

在设置启用期间，调用中给出的路由必须是 `allowedRoutes` 之一。

### 工作区文档

项目通过提交 `<projectRoot>/.dsh/team.json` 固定自己的团队：

```json
{
  "version": 1,
  "members": [
    { "name": "recon", "description": "Maps the tree before anything changes." },
    { "name": "reviewer", "description": "Reads the diff.", "context": "fork", "provider": "deepseek-official", "model": "deepseek-v4-flash" }
  ]
}
```

除 `version` 外每个字段都是可选的，并且只覆盖它点名的那个全局字段；省略的字段继承全局值。`members` 例外，它按名字合并：工作区声明的成员替换同名的全局成员，全局没有的名字追加在全局编制之后，未声明 `members` 时全局编制原样保留。`members` 条目给出 `name` 与 `description`，可选给出 `prompt`、`context`（默认 `fresh`）、`sandboxMode`（`read-only`／`workspace-write`／`danger-full-access`，省略即随团队自身默认）、`provider`、`model` 与 `reasoningEffort`；声明了 `provider` 就必须同时给出 `model`。`allowedRoutes` 与 `roleRoutes` 的每一条也可给出可选的 `reasoningEffort`。成员自带的路由优先于该成员名字上的预设。两层的 `description` 都必须是非空字符串，因此带空描述的 `team.json` 现在会被拒绝，需要先行修正。

### 获得的功能

服务 `ctx.agentTeamLlm` 暴露 `current()`（全局层）、`resolveFor(workspaceRoot)`（合并后的值）、`readWorkspaceDocument(root)` 与 `saveWorkspaceDocument(root, document)`（文档本身），以及 `routeFor(name)`（单个成员的路由）。两个 `agentTeamLlm` Remote 供浏览器使用：`readTeamDocument` 与 `saveTeamDocument`。两者都接收会话的工作区作用域，在 Host 上推导 `<scope root>/.dsh/team.json`，绝不接受来自线路的路径。teammate 会保留自己持久化的路由，因此预设对该名字的每次后续创建都生效，且 teammate 会按自己 descriptor 记录的路由恢复。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`current()` 解析 reasoning effort 的品牌并校验全局文档：成员名格式非法、占用 Lead 保留名或重复会被拒绝，编制超过 `maxMembers` 会被拒绝，启用状态下允许清单为空、或预设路由不在清单内也会被拒绝。`routeFor(name)` 在文档停用时按停用处理，因此从不启用设置的部署仍然沿用 Lead 的路由。

工作区文档由手写解码器解析，而不是交给 schema 库，因为每次拒绝都必须点名字段，未知字段必须报错而不是被丢弃。`resolveFor` 从给定目录逐级向上找到最近的 `.git` 条目——worktree 的 `.git` 文件也算——找不到或项目根下没有文档时原样返回全局值。合并以全局编制为基底，按名字替换或追加，因此项目可以只调整其中一名成员而不必重述其余成员。写入通过随机后缀的同目录临时文件替换目标，因此并发读者只会看到旧的或新的完整文档，被拒绝的文档不会覆盖已有的好文档。

本包只负责配置。把路由解析为子代理选项、以及运行中 adapter 的预检，都留在 [`@deepseek-ai/dsh-experimental-tool-agent-team`](../tool-agent-team/README.zh.md)：它把预设作为 Subagent seam 在调用方字段之下合并的「已配置」层传入。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [实验性包](../README.zh.md)——孵化状态与发布规则。
- [Agent Teams 服务](../agent-team/README.zh.md)——持久 roster、消息与任务板。
- [Agent Teams 工具](../tool-agent-team/README.zh.md)——Team-scoped 模型工具表层。

-----

<a id="model-experience"></a>
## 模型体验

### 团队 LLM 路由

#### 模型看到什么

什么都不加。本文档改变的是每个 teammate 跑在哪个 LLM 上；它不增加提示词文本、工具 schema 或工具结果。`list_agents` 在该成员已加载时报告它的 model。

#### Token 影响

无。本包不贡献任何模型可见内容。

#### KV Cache 影响

预设路由与 Lead 不同的 teammate 不再共享 Lead 的请求前缀。保持原路由的 teammate 前缀不变。

### 固定编制

#### 模型看到什么

Lead 在组建团队时读到每个编制成员的 `name` 与 `description`，成员的 `prompt` 则成为该成员自己的开场指令。因此任意一层加一份编制，都会在下一次组队调用时增加模型可见文本；两层都没有 `members` 时不增加任何内容。

#### Token 影响

Lead 的工具结果里每位成员一份 `name` 与 `description`，外加该成员首次请求里一次性的 `prompt`。两层都没有声明 `members` 时两者都不存在。

#### KV Cache 影响

成员的 `prompt` 只构成该成员自己首次请求的前缀，并在该成员后续轮次中保持缓存。修改它会使该成员的前缀失效；Lead 自己的前缀不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅 Web 可编辑**——在没有 Web 或 Desktop 客户端时，设置文档是唯一入口；headless 部署通过 `cordis.patch.yml` 编辑，或提交 `<projectRoot>/.dsh/team.json`。
- **只支持精确路由**——预设只给一个 provider 与 model，没有按能力或最便宜模型的选择。
- **没有按任务的路由**——预设以 teammate 名字为键，因此按任务区分的编制需要一名一路由。
- **路由仍整表覆盖**——工作区文档会替换它声明的全局 `allowedRoutes` 或 `roleRoutes` 清单，而不是向其中追加，因此项目无法只往部署清单里加一条路由；`members` 则是按名字合并。
- **编制上限按层计算**——`maxMembers` 分别约束每一层，因此当工作区文档声明一整份全局编制里没有的名字时，这些成员会并入全局编制，组建出的团队最多可达该上限的两倍；`spawn_team` 不再额外限制。
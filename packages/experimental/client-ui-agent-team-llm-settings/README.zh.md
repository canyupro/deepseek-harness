---
description: "插件页上的 Agent Teams 子 LLM 路由设置卡片：允许清单、默认路由与按 teammate 名字的预设。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-agent-team-llm-settings

[English](README.md) | 中文

## 概述

本包是 `@deepseek-ai/dsh-experimental-agent-team-llm-settings` 的浏览器半边。它在插件页加一张可编辑卡片，用来选择 teammate 可以运行在哪些 LLM 路由上、没有预设的名字使用哪条回退路由，以及每个名字的路由、成员编制与权限预设。卡片通过 `ctx.configForms` 编辑部署文档，通过 Host 的文档 Remote 编辑当前会话的 `<projectRoot>/.dsh/team.json`；工作区保存是叠加语义，只写入已声明或已改动的字段。会话 cwd 没有项目根时，工作区页签保持禁用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把它与 Host 包一起挂在 Web 或 Desktop 组合里。`@deepseek-ai/dsh-experimental-agent-team-profile` 已经同时挂载了两者。卡片出现在该 bundle 下的插件页，且仅在 Host 提供 `agent-team-llm-settings` 命名空间时出现。

工作区层从**会话身份**解析项目根，因为 Host 是从会话的 cwd 推导项目根的。它使用主视图持有的会话；在没有持有主视图保留的场合——也就是设置页本身——它向 Host 询问可以提供哪些会话，并取创建时间最近的那一个，因为候选是按会话 header 的创建时间排序的，而不是按最近使用。工作区页签把这个列表渲染成一个下拉，让用户可以把该层指向另一个项目；解析出的文档路径仍显示在卡片上，使选错可见而不是无声。切到工作区页签会读取 `<projectRoot>/.dsh/team.json`；项目尚未存储该文档时从空文档开始编辑。页签会说明是哪个边界拦下的：没有提供任何会话，或会话不属于任何项目。首次读取失败会在页签下方说明原因并提供重试，因为读取成功前页签一直禁用，而它自己的错误提示位于页签内部。

本包像其它实验性客户端那样自行挂载 Host 的 `agentTeamLlm` Remote 生成物，因此工作区层无需在发布包 `@deepseek-ai/dsh-api-remotes` 装配里登记。Host 包是 peer 依赖：未挂载时工作区页签只会得到一次读失败提示。

模型候选项来自部署中运行中的 adapter 目录，因此卡片列出的正是这套安装能触达的 provider 与 model。目录已不再公布的存量路由仍然可见、可移除，而不会被静默丢弃。

权限候选项来自已组合的权限预设，是向 Host 询问而不是写死的，因此成员行给出的是本部署自己的预设名，以及每个预设写入的 sandbox mode 与 approval policy。存量旋钮对不匹配任何已配置预设时，成员行显示权限域给出的派生值，那是一个展示状态而不是可选项；组合里没有该权限域时则不提供任何具名预设。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器入口：Remote 生成物与挂载调用 |
| [`src/client/mount.ts`](src/client/mount.ts) | 该生成物的 `$mount`、locale 字典与 `configForms.whileServed` 之后的 `plugins.item` 注册，以及成对的 disposer |
| [`src/client/agent-team-llm-card-controller.ts`](src/client/agent-team-llm-card-controller.ts) | 每层一份暂存草稿、Host 规则校验、目录加载、工作区读取、带 revision 校验的保存 |
| [`src/client/team-document.ts`](src/client/team-document.ts) | 工作区文档、成员规则，以及 `readTeamDocument` / `saveTeamDocument` 的 Remote 切片 |
| [`src/client/AgentTeamLlmCard.tsx`](src/client/AgentTeamLlmCard.tsx) | 卡片外壳、作用域切换与唯一的保存页脚 |
| [`src/client/AgentTeamLlmFields.tsx`](src/client/AgentTeamLlmFields.tsx) | 开关、已授权路由编辑器（可手填路由与 effort）、默认路由与预设行 |
| [`src/client/AgentTeamLlmMembers.tsx`](src/client/AgentTeamLlmMembers.tsx) | 两层中的编制行，含每行的权限预设、提示词、路由字段与其违反的规则 |

控制器为每一层各保留一份暂存草稿，因此编辑工作区编制不会影响全局草稿。全局层通过 `ctx.configForms.get('agent-team-llm-settings')` 读取，并按同一个 revision 保存；工作区层通过两个 Remote 读写。`problemsOf` 与 Host 的路由校验保持一致，`agentTeamLlmMemberProblems` 与其成员规则一致；外壳会把两者折入 `invalid`，从而阻止保存。工作区保存会先问 `documentScope` 哪些可选字段是项目已声明或用户改过的，其余字段一律不写，让项目继续继承。

`reasoningEffort` 属于相等性而不只是身份：`sameRoutes`、`sameRoles` 与 `sameAgentTeamLlmMember` 都比较它，因此只改 effort 的草稿也是 dirty，保存按钮保持可用。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent Teams 路由设置（Host）](../agent-team-llm-settings/README.zh.md)——本卡片编辑的文档、它的解析顺序与校验。
- [Agent Teams 工具](../tool-agent-team/README.zh.md)——消费解析结果路由的模型工具面。
- [实验性包](../README.zh.md)——孵化状态与发布规则。

-----

<a id="model-experience"></a>
## 模型体验

### 团队 LLM 路由卡片

#### 模型看到什么

什么都不加。本包只渲染产品用户界面；它不增加提示词文本、工具 schema 或工具结果。teammate 跑哪条路由由 Host 服务在创建时决定。

#### Token 影响

无。本卡片只写入 `agent-team-llm-settings` 字段与 `<projectRoot>/.dsh/team.json`，二者都不会进入模型请求。

#### KV 缓存影响

自身无影响。本卡片改动的路由在下一个 teammate 被创建时生效；当该 teammate 的路由与 Lead 不同时，它就不再共享 Lead 的请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不能试跑路由**——卡片无法试用某条路由，因此已注册但不可达的 adapter 只有在 teammate 首次运行时才会暴露。
- **工作区的默认路由无法清空**——Host 把「出现的」`defaultProvider`/`defaultModel` 读作两个非空字符串，因此工作区层用「省略整对」来表示未设置默认路由。已经设过默认路由的项目会一直能编辑它，除非直接改文档。
- **默认项目是启发式的**——没有主视图保留时，工作区层打开 Host 创建时间最近的顶层会话，而创建时间不等于最近使用，因此那个会话不一定是用户所指的项目。下拉与解析出的文档路径让这个选择可核对、可纠正。
- **成员数量上限由 Host 决定**——部署的 `maxMembers` 不在卡片读到的文档里，超限的编制会在写入时被拒，而不是在编辑器里被拦下。
- **此处不校验成员路由是否在允许清单内**——成员的路由是否被授权，由 Host 在建人时判定。
- **成员的权限是预设而不是自由旋钮对**——卡片只提供本部署已配置的预设，因此不匹配任何预设的旋钮对只能显示、不能编辑；要改就得改选另一个预设。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

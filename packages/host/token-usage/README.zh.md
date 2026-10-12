---
description: "把持久会话日志折叠成用量面板所渲染数字的跨会话 token 用量 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-token-usage

[English](README.md) | 中文

## 概述

`host-token-usage` 为用量面板提供数据。它用一个 Host Remote 把 Host 能读到的全部持久会话日志折叠成 token 数字——总计、按路由的行、按天与按小时的桶、会话行与连续活跃天数——浏览器只负责渲染，不自己读日志。折叠放在 Host，因为只有 Host 能读持久日志。数字按进程缓存；带 `force` 的查询会重读全部日志，并发的 force 查询共享同一次读取，因此一整页面板不会把这份工作成倍放大。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把它作为 `cordis.yml` 的一行挂载。它注入 `sessionQuery`；缺少该服务时 fiber 会一直处于 pending，因此已挂载的 controller 总有语料可读，而不会回答「不可用」。

该类注册生成的 `ctx.remote.tokenUsage` 命名空间。客户端调用 `ctx.remote.tokenUsage.query({ force?: boolean })` 并收到 `TokenUsageResponse`：面板数据加上 `cachedAt` 与 `cached`。`force` 绕过进程内缓存，重读每一份可读日志。

浏览器半边是 `@deepseek-ai/dsh-client-ui-usage`，它调用该 Remote 并渲染这些数字。

<a id="understand-the-implementation"></a>
## 理解实现

`aggregateUsage` 累加提供方在每条助手消息上回报的 token 计数：`inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens` 与 `reasoningTokens`。`totalTokens` 由四个计费计数相加得出，而不是采信提供方的总计。

日键与时键按 Host 本地时区计算；连续天数与周边界运算把本地日键当作 UTC 日序号处理，因此结果不会随运行时偏移而漂移。连续活跃天数统计截至今天或昨天的连续活跃日。会话行携带会话 id、工作目录、创建时间以及首末事件时间，并以 `SESSION_ROW_LIMIT`（50）为上限。

<a id="further-exploration"></a>
## 进一步探索

- 响应与行类型在 `src/types.ts`。
- 折叠、桶边界与连续天数运算在 `src/aggregate.ts`，其测试就在旁边。

## 模型体验

无。该包是对持久会话日志的宿主端用量投影，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只统计日志记录到的部分**——从未进入会话日志的提供方调用（例如授权审查）在这里不可见，因此这些总计可能与提供方自己的账单不一致。
- **命中率是客户端自己算的**——响应只携带各项计数，面板据此推导缓存命中率，不存储比例本身。
- **会话行上限为 50**——语料超过该数时，展示最大的若干行加上整语料总计，而不是每个会话。
- **桶遵循 Host 时区**——处在其他时区的客户端读到的是 Host 的日界与时界。
- **缓存按进程**——没有任何机制监听日志，因此只有调用方传 `force` 时数字才会变化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

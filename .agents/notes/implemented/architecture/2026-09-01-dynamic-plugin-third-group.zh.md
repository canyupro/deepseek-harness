# Agent Note: User-defined dynamic plugins in the plugin list

Status: implemented

[English](2026-09-01-dynamic-plugin-third-group.md) | 中文

## 问题

设置 → 插件列表投影非组 Loader 条目，并自[Agent 预设作用域变更](../../archived/architecture/2026-08-29-plugin-inventory-agent-preset-scopes.md)起携带每个 roster 预设的组合——但用户自定义的动态 Cordis 插件无处可见。这些插件以动态 runner 自身分组下的临时 fiber 挂载，而不是 Loader 条目，也没有任何预设声明它们，因此列表读作“已组合的全部”，却静默省略了一整个平面：在会话内定义过提示词增强或用量统计插件的用户看不到它、它的版本、所属会话，或它是否在运行。

## 决策

**清单携带第三个无来源分组。** `pluginInventory/list` 新增可选的 `dynamic` 数组——当前宿主进程 runner 已知的每个用户自定义插件一行——经 `ctx.get('dynamicCordisRunner')` 从 runner 的清单投影，与 `agentPresets` 同一种可选伙伴模式。每行携带稳定插件 id、最新包的名称与用途、所属会话 id、不可变包版本数、完成激活时的当前包 id，以及封闭词汇 `running | waiting | in-flight | failed | stopped` 中的阶段。runner 保留其运行 id 与内部状态；清单行不暴露其中任何一个。

**阶段是推导的，不是上报的。** 有激活在进行时映射为 `running`，当前尝试自身等待批准或浏览器时为 `waiting`；过渡状态（`awaiting-approval`、`starting-host`、`client-pending`）折叠为 `in-flight`；终态失败（`failed`、`rejected`、`cancelled`）映射为 `failed`；其余为 `stopped`。

**列表把它渲染为独立的可折叠分组。** 动态分组位于全局平面之后，默认展开，带自己的副标题与计数。每张卡片以最新包名为标题，携带一个阶段标签——运行中（成功绿）、等待中（警示琥珀）、启动中（业务蓝）、失败（错误红）、已停止（中性）——展开后列出插件 id、所属会话、版本数、激活完成时的当前版本，以及声明的用途。Loader 与预设卡片共享的模块名行改为可选并在此省略：动态卡片的身份行就是插件 id。搜索像其他分组一样匹配最新包名与插件 id；分类筛选刻意不适用，因为动态行不携带分类。该分组只在 runner 报告了插件时渲染——未挂载 runner 的部署，或未定义任何插件的进程，什么都不显示而不是渲染空壳。

## Alternatives considered

**把动态行并入 Loader 条目平面。** 拒绝：Loader 是条目的唯一生命周期权威，不拥有这些插件的状态——合并会误报启停与阶段，并破坏清单的单生命周期真源设计。

**采纳 runner 的内部清单行作为 wire 契约。** 拒绝：该行携带 plugin-run id 与内部状态；清单拥有公共的无来源词汇，runner 的变更才不会波及可信客户端契约。

**客户端对 runner 发起第二次 Remote 调用。** 拒绝：标签页每次挂载经 `pluginInventory.list()` 取一份快照；第二次调用会拆散新鲜度契约并复制 [`api-remotes`](../../../../packages/api/remotes/README.zh.md) 路径。

**把动态插件渲染进预设分组。** 拒绝：它们不携带预设身份、trust 标记或启停门，预设形状的卡片会读作空语义。

## Verification

- `packages/host/plugin-inventory/tests/inventory.spec.ts` 覆盖每个阶段映射（带等待尝试的激活 → 等待，激活 → 运行，每个过渡状态 → 启动中，每个终态失败 → 失败，其余 → 已停止）、无包时回退到插件 id，以及 `currentPackageId` 缺省。
- `packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx` 覆盖第三分组的折叠开关、计数、阶段标签、展开事实、搜索隔离与收起；两个包的不变式伴生插件均已覆盖。
- `pnpm run test:gui`、两个编译面的 `tsc -b`，以及 client-i18n 与包依赖门禁在该改动上全部通过。

## Consequences

标签页如今能在一处回答“我在本会话定义了什么”——但这些行只属于当前进程：宿主重启会清空所有用户自定义插件、分组随之消失，因此列表的完整性以运行中的进程为界，而不是持久历史。`dsh-host-plugin-inventory` 新增对 `dsh-cordis-host-runner` 的可选 peer 依赖（peer + dev，经依赖策略分类），client 快照类型沿用既有 api-remotes 再导出，无需重新生成 typert 产物。[分类 chips](2026-08-14-plugin-row-category-metadata.zh.md) 仍只收窄全局平面；动态行在其之外，阶段标签是运行状态摘要而不是更深的诊断。

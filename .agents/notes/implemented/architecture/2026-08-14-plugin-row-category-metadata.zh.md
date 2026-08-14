# Agent Note: 插件行分类元数据与分类化插件列表

Status: implemented

[English](2026-08-14-plugin-row-category-metadata.md) | 中文

## Problem

Web 插件列表把每个 Loader 条目放在一个扁平、可搜索的目录里。面对上百个行——涵盖启动基础设施、能力 seam、浏览器 UI 与辅助服务——列表既无法按“这个插件是做什么的”收窄范围，分类本身也没有声明式归宿：任何分桶逻辑都只能在客户端按模块名前缀猜测。

## Decision

每个 Loader 行都可以在自己的 `cordis.yml` 行中声明静态的 `category` 元数据字段；插件列表把条目分成四个产品桶——最小系统（`core`）、扩展系统（`extension`）、UI界面（`ui`）与其他插件（`other`）——并通过目录上方的单选 chips 筛选。

- `EntryOptions.category`（`string | null`，可选）是与 `name` 一样的惰性 Loader 元数据：条目更新、补丁应用（`applyEntryPatches` 原样保留未触及的键）与 `dsh --dump-config` 都会逐字携带它，Loader 本身不读取它。这一 vendored 改动登记为 vendor/README.md 第 19 条。
- `PluginInventoryEntry.category` 是封闭联合类型 `core | extension | ui | other`（`PluginCategory`）。清单网关投影原始行值；缺失、`null` 或无法识别的值投影为 `other`——回退桶正是该字段的契约，而不是被跳过的错误。
- 发布组合在每个非 group 行上声明该值：`core` 是启动/会话/模型/Agent 主干加护栏与存储；`extension` 是能力 seam（shell、fs、web、skill、subagent、workflow、compaction）与标准 Agent 体验插件（todo、plan、goal、commands）；`ui` 是浏览器插件（`dsh-client-ui-*` 与其他仅 UI 的客户端包），浏览器传输（`connection`、`client-runtime`、`locale`、`modules`）计入 `core`；`other` 收纳辅助行（遥测、消息反馈）。以基础行为目标的补丁行不重复声明该字段——补丁会保留它。
- `scripts/verify-cordis-config.ts` 把 `category` 加入静态元数据字段（禁止 `!!js`），并拒绝四桶集合之外的值，因此发布组合里拼错的值会在 gate 阶段失败，而不是悄悄退化成 `other`。
- UI 在目录上方新增单选 chip 行（全部加四个桶），与搜索查询叠加生效，并在每张卡片上显示分类标签。选择只属于视图：组件重新挂载时回到“全部”，不做设置持久化。所扩展的标签页结构是 [`settings.plugins.tab` ledger](2026-08-11-plugin-settings-tabs.md)。

## Alternatives considered

**客户端按名称前缀启发式推断。** 拒绝：`dsh-client-ui-*` 规则会误分类第三方与改名的插件，且分类会与拥有它的组合漂移。

**在清单服务里维护模块名映射表。** 拒绝：关于“什么在运行”的第二份权威清单需要随行的移动或改名自行同步；逐行元数据把事实放在声明它的行旁边。

**在 Loader 内校验。** 拒绝：vendored Loader 保持对分类无感知（`string | null`）；由 harness 拥有封闭枚举并在静态 gate 校验发布值。

## Verification

- `packages/host/plugin-inventory/tests/inventory.spec.ts` 覆盖已知值的投影与未知值回退 `other`。
- `scripts/verify-cordis-config.spec.ts` 覆盖枚举拒绝与 `category: !!js` 拒绝。
- `packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx` 覆盖 chip 筛选、chip 与查询叠加、卡片标签与展开卡片重置。
- `apps/web/tests/settings-chrome.e2e.ts` golden 在组装后的浏览器中捕获 chip 行与逐卡标签。

## Consequences

发布组合里新增的行若不带 `category` 会落入其他插件；`verify-cordis-config` gate 只在字段存在时要求它，因此漏标的行表现为一条错分类的列表项，而不是启动失败。`pluginInventory/list` 的 Typert Remote 产物随新字段重新生成（`pnpm run build:lib:host`）。preset 行不会出现在这里：列表投影 `ctx.loader.entries()`，而 preset 树属于会话平面。

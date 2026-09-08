# Agent Note: The personal plugin library with three lifecycle states

Status: implemented

[English](2026-09-01-personal-plugin-library.md) | 中文

## 问题

用户自定义的动态 Cordis 插件按设计只存在于进程内：重启即丢失，源码与授权都不持久，用户反复迭代的插件在下次 `dsh web` 启动时就没了。此前唯一走向永久的路径是把插件转成仓库包，这对个人工具过于沉重。也没有任何管理界面：插件列表只显示会话的动态插件，无法保存、开启、关闭、固化或移除。

## 决策

**runner 获得一个持久的个人插件库。** `DynamicCordisRunnerService` 把保存的插件持久化到宿主 home 下的 JSON 文档（`$DSH_HOME/plugins/library.json`，经新增的 `libraryHome` 配置项指定），并在启动时重新挂载。持久化文档带版本号，并在文件边界校验；文件缺失读作空库，损坏则大声失败。

**保存的插件处于三种状态之一**，直接映射到 runner 现有的授权词汇：

- **`off`（保存并关闭）**——已保存、不运行。插件仍留在 registry 中让列表可见；`applyLibraryState` 撤下任何进行中的运行。
- **`on-editable`（保存并开启，可修改）**——已保存并运行，且 `clientVersionUpdatesApproved = true`，迭代新版本无需重复授权。
- **`frozen`（固化，不可修改）**——已保存并运行，插件级授权被清除，`approvedClientPackages` 只保留当前版本，因此更新（新包）需要二次授权。

**会话 agent 管理个人库。** 保存把会话插件重新归属到合成的 `cordis-library` 会话；`managedPlugin` 辅助把库拥有的插件视为任何会话 agent 都可管理，因此 `define`（追加包）、`run`、`getClientCode`、`resolveRequestRun`、`stop` 与渲染失败上报都能作用于库插件。新增动词——`saveToLibrary`、`setLibraryState`、`removeFromLibrary`——加上启动用的 `mountLibrary()`，构成完整表面。客户端 plugin-inventory 表面把第三分组渲染成带库状态徽标与按状态操作（保存并开启 / 保存并关闭 / 开启 / 关闭 / 固化 / 解除固化 / 移除）。

**启动自动挂载**重建每个持久化插件（包括 `off` 的，让列表始终反映库），然后在持久化授权下激活运行状态——启动时不需要批准。

## Alternatives considered

**为永久化把插件转成仓库包。** 拒绝：个人工具不应要求包脚手架、门禁与发布审查；个人库保留轻量的动态编写模型，并在其后加持久化。

**只持久化授权，不持久化定义。** 拒绝：重启会丢掉源码，库无法重新挂载任何东西；整个定义（host/client 代码、名称、用途、版本）必须持久。

**每次启动都重新批准。** 拒绝：与“自动运行”的目标相悖；授权按版本记录在持久化条目中并在启动时复用，只有固化插件的全新版本才需要新批准。

**保存后插件仍归会话所有。** 拒绝：个人库是用户的私人存储，不是会话产物；重新归属到稳定的库会话让清单与管理表面与会话无关。

## Verification

- `packages/extensions/cordis-host-runner/tests/library-store.spec.ts` 覆盖持久化文档：路径推导、缺失即空、原子往返，以及文件边界上每个畸形字段的拒绝。
- `packages/extensions/cordis-host-runner/tests/library.spec.ts` 覆盖保存/持久化/重新归属、带授权映射的三状态流转（`on-editable` 中新版本免批准运行、`frozen` 中需要批准）、移除，以及可修改/固化/关闭插件的启动重挂载。
- `packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx` 覆盖按状态操作按钮及其会话/插件参数；宿主投影测试覆盖 `libraryState` 透传。
- 包依赖与 client-i18n 门禁在该改动上全部通过。

## Consequences

用户保存的插件能跨重启存活并自动运行，插件列表成为它们的管理器——但个人库按宿主存储，授权被信任（固化版本直接运行其已批准代码，不再每次提示，因此持久化把信任决策从每次启动移到首次激活）。`dsh-host-plugin-inventory` 的动态行新增可选的 `libraryState` 字段，runner 的 Remote 表面新增三个动词；typert 客户端产物随构建重新生成。为 `on-editable` 插件编辑代码（而非仅追加新版本）仍是后续表面。

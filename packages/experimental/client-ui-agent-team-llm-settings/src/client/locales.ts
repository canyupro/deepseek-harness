/** Locale bundles for the Agent Team LLM routing settings card. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Rules the card refuses to save. Each key names the copy for the Host rule it
 * reports; the card carries them in {@link AgentTeamLlmSettingsLocaleKey}.
 */
export type AgentTeamLlmProblemKey =
  | 'agentTeamLlmRequiredRoutes'
  | 'agentTeamLlmDefaultIncomplete'
  | 'agentTeamLlmRouteNotAllowed'
  | 'agentTeamLlmRoleNameRequired'
  | 'agentTeamLlmRoleNameDuplicate'
  | 'agentTeamLlmRoleRouteRequired'

/**
 * Rules one workspace member row is refused for. Each key names the copy for the
 * Host rule it reports; the card carries them in
 * {@link AgentTeamLlmMemberProblemKey}.
 */
export type AgentTeamLlmMemberProblemLocaleKey =
  | 'agentTeamLlmMemberNameRequired'
  | 'agentTeamLlmMemberNameFormat'
  | 'agentTeamLlmMemberNameReserved'
  | 'agentTeamLlmMemberNameDuplicate'
  | 'agentTeamLlmMemberDescriptionRequired'
  | 'agentTeamLlmMemberRouteIncomplete'

/** Locale keys the card renders. */
export type AgentTeamLlmSettingsLocaleKey =
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed'
  | 'title' | 'description'
  | 'agentTeamLlmToggle' | 'agentTeamLlmChoose' | 'agentTeamLlmOff'
  | 'agentTeamLlmAllowed'
  | 'agentTeamLlmLoading' | 'agentTeamLlmLoadFailed' | 'agentTeamLlmRetry'
  | 'agentTeamLlmPartial' | 'agentTeamLlmUnavailable' | 'agentTeamLlmUnavailableGroup' | 'agentTeamLlmEmpty'
  | 'agentTeamLlmDefault' | 'agentTeamLlmDefaultNone'
  | 'agentTeamLlmRoles' | 'agentTeamLlmRolesEmpty' | 'agentTeamLlmRoleName'
  | 'agentTeamLlmRoleNamePlaceholder' | 'agentTeamLlmRoleRoute' | 'agentTeamLlmRoleRouteNone'
  | 'agentTeamLlmRoleAdd' | 'agentTeamLlmRoleRemove'
  | 'agentTeamLlmConflict'
  | 'agentTeamLlmScopeLabel' | 'agentTeamLlmScopeGlobal' | 'agentTeamLlmScopeWorkspace'
  | 'agentTeamLlmWorkspaceLoading' | 'agentTeamLlmWorkspaceUnavailable'
  | 'agentTeamLlmWorkspaceNoWorkspace' | 'agentTeamLlmWorkspaceNoProjectRoot'
  | 'agentTeamLlmWorkspaceLoadFailed' | 'agentTeamLlmWorkspaceSaveFailed'
  | 'agentTeamLlmWorkspaceRetry' | 'agentTeamLlmWorkspacePath'
  | 'agentTeamLlmWorkspacePicker' | 'agentTeamLlmWorkspaceDefault'
  | 'agentTeamLlmMembers' | 'agentTeamLlmMembersEmpty'
  | 'agentTeamLlmMemberName' | 'agentTeamLlmMemberNamePlaceholder'
  | 'agentTeamLlmMemberDescription' | 'agentTeamLlmMemberDescriptionPlaceholder'
  | 'agentTeamLlmMemberPrompt' | 'agentTeamLlmMemberPromptPlaceholder'
  | 'agentTeamLlmMemberContext' | 'agentTeamLlmMemberContextFresh' | 'agentTeamLlmMemberContextFork'
  | 'agentTeamLlmMemberSandbox' | 'agentTeamLlmMemberSandboxInherit' | 'agentTeamLlmMemberSandboxReadOnly'
  | 'agentTeamLlmMemberSandboxWorkspaceWrite' | 'agentTeamLlmMemberSandboxFullAccess'
  | 'agentTeamLlmMemberRoute' | 'agentTeamLlmMemberRouteNone'
  | 'agentTeamLlmMemberAdd' | 'agentTeamLlmMemberRemove'
  | 'agentTeamLlmManualTitle' | 'agentTeamLlmManualHint'
  | 'agentTeamLlmRouteProvider' | 'agentTeamLlmRouteProviderPlaceholder'
  | 'agentTeamLlmRouteModel' | 'agentTeamLlmRouteModelPlaceholder'
  | 'agentTeamLlmRouteEffort' | 'agentTeamLlmRouteEffortPlaceholder'
  | 'agentTeamLlmRouteAdd' | 'agentTeamLlmRouteRemove'
  | 'agentTeamLlmRoleEffort'
  | AgentTeamLlmProblemKey
  | AgentTeamLlmMemberProblemLocaleKey

/** English copy. */
export const en: Record<AgentTeamLlmSettingsLocaleKey, string> = {
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  title: 'Team LLM Settings',
  description: 'Edit the teammate model routes, the default route, and per-name presets on this page.',
  agentTeamLlmToggle: 'Allow teammates to use configured routes',
  agentTeamLlmChoose: 'When enabled, teammates run on the routes you authorize below. A preset applies to the teammate whose name it carries; otherwise the default route applies, and a teammate with neither inherits the Lead\'s route. Applies only to new teammates.',
  agentTeamLlmOff: 'Teammates inherit the Lead\'s route. Saved routes are kept and apply when you enable this.',
  agentTeamLlmAllowed: 'Routes teammates may run on',
  agentTeamLlmLoading: 'Loading models…',
  agentTeamLlmLoadFailed: 'Models could not be loaded.',
  agentTeamLlmRetry: 'Retry',
  agentTeamLlmPartial: 'Some model providers could not be loaded; saved routes remain removable.',
  agentTeamLlmUnavailable: 'Currently unavailable',
  agentTeamLlmUnavailableGroup: 'Saved but currently unavailable',
  agentTeamLlmEmpty: 'No model provider currently advertises a model.',
  agentTeamLlmDefault: 'Default route',
  agentTeamLlmDefaultNone: 'No default route',
  agentTeamLlmRoles: 'Preset routes by teammate name',
  agentTeamLlmRolesEmpty: 'No preset routes. Teammates use the default route.',
  agentTeamLlmRoleName: 'Teammate name',
  agentTeamLlmRoleNamePlaceholder: 'Teammate name',
  agentTeamLlmRoleRoute: 'Route',
  agentTeamLlmRoleRouteNone: 'Choose a route',
  agentTeamLlmRoleAdd: 'Add preset',
  agentTeamLlmRoleRemove: 'Remove',
  agentTeamLlmConflict: 'Settings changed elsewhere. Discard your draft and try again.',
  agentTeamLlmRequiredRoutes: 'Authorize at least one route before saving.',
  agentTeamLlmDefaultIncomplete: 'A default route needs both a provider and a model, or choose no default route.',
  agentTeamLlmRouteNotAllowed: 'Every preset and the default route must be one of the authorized routes.',
  agentTeamLlmRoleNameRequired: 'Every preset needs a teammate name.',
  agentTeamLlmRoleNameDuplicate: 'Preset teammate names must be unique.',
  agentTeamLlmRoleRouteRequired: 'Every preset needs a route.',
  agentTeamLlmScopeLabel: 'Settings scope',
  agentTeamLlmScopeGlobal: 'Global',
  agentTeamLlmScopeWorkspace: 'Workspace',
  agentTeamLlmWorkspaceLoading: 'Looking for this project\'s team document…',
  agentTeamLlmWorkspaceUnavailable: 'This workspace has no project root, so it has no workspace team document to edit.',
  agentTeamLlmWorkspaceNoWorkspace: 'The sidebar lists no workspace yet, so there is no workspace team document to edit.',
  agentTeamLlmWorkspaceNoProjectRoot: 'This workspace belongs to no project, so it has no workspace team document to edit.',
  agentTeamLlmWorkspaceLoadFailed: 'The team document could not be read.',
  agentTeamLlmWorkspaceSaveFailed: 'The team document was not saved.',
  agentTeamLlmWorkspaceRetry: 'Retry',
  agentTeamLlmWorkspacePath: 'Team document',
  agentTeamLlmWorkspacePicker: 'Choose a workspace',
  agentTeamLlmWorkspaceDefault: 'Default workspace',
  agentTeamLlmMembers: 'Team members',
  agentTeamLlmMembersEmpty: 'No members. Teammates use the routes above.',
  agentTeamLlmMemberName: 'Member name',
  agentTeamLlmMemberNamePlaceholder: 'lowercase-name',
  agentTeamLlmMemberDescription: 'Description',
  agentTeamLlmMemberDescriptionPlaceholder: 'What this member is for',
  agentTeamLlmMemberPrompt: 'Opening instructions',
  agentTeamLlmMemberPromptPlaceholder: 'What this member always starts from',
  agentTeamLlmMemberContext: 'Context',
  agentTeamLlmMemberContextFresh: 'Start fresh',
  agentTeamLlmMemberContextFork: 'Fork the Lead',
  agentTeamLlmMemberSandbox: 'Permissions',
  agentTeamLlmMemberSandboxInherit: 'Team default',
  agentTeamLlmMemberSandboxReadOnly: 'Read only',
  agentTeamLlmMemberSandboxWorkspaceWrite: 'Write in this workspace',
  agentTeamLlmMemberSandboxFullAccess: 'Full access',
  agentTeamLlmMemberRoute: 'Member route',
  agentTeamLlmMemberRouteNone: "Use the teammate's own route",
  agentTeamLlmMemberAdd: 'Add member',
  agentTeamLlmMemberRemove: 'Remove',
  agentTeamLlmManualTitle: 'Add a route by hand',
  agentTeamLlmManualHint: 'For a provider the directory above does not advertise: type its provider and model, then authorize it in the list.',
  agentTeamLlmRouteProvider: 'Provider',
  agentTeamLlmRouteProviderPlaceholder: 'provider id',
  agentTeamLlmRouteModel: 'Model',
  agentTeamLlmRouteModelPlaceholder: 'model id',
  agentTeamLlmRouteEffort: 'Reasoning effort',
  agentTeamLlmRouteEffortPlaceholder: 'model default',
  agentTeamLlmRouteAdd: 'Add route',
  agentTeamLlmRouteRemove: 'Remove route',
  agentTeamLlmRoleEffort: 'Preset reasoning effort',
  agentTeamLlmMemberNameRequired: 'Every member needs a name.',
  agentTeamLlmMemberNameFormat: 'Member names use lowercase words joined by single hyphens.',
  agentTeamLlmMemberNameReserved: 'The name \'lead\' belongs to the session lead.',
  agentTeamLlmMemberNameDuplicate: 'Member names must be unique.',
  agentTeamLlmMemberDescriptionRequired: 'Every member needs a description.',
  agentTeamLlmMemberRouteIncomplete: 'A member route needs both a provider and a model.',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentTeamLlmSettingsLocaleKey, string> = {
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  title: '团队 LLM 设置',
  description: '在插件页编辑 teammate 允许使用的模型路由、默认路由，以及按名字的预设。',
  agentTeamLlmToggle: '允许队友使用配置的路由',
  agentTeamLlmChoose: '开启后，队友会运行在下方授权的路由上。按名称匹配的预设优先，否则使用默认路由；两者都没有的队友继承 Lead 的路由。仅影响新建的队友。',
  agentTeamLlmOff: '队友继承 Lead 的路由。已保存的路由会保留，开启后生效。',
  agentTeamLlmAllowed: '队友可以运行的路由',
  agentTeamLlmLoading: '正在加载模型…',
  agentTeamLlmLoadFailed: '无法加载模型。',
  agentTeamLlmRetry: '重试',
  agentTeamLlmPartial: '部分模型提供方暂时无法加载；已保存的路由仍可移除。',
  agentTeamLlmUnavailable: '当前不可用',
  agentTeamLlmUnavailableGroup: '已保存但当前不可用',
  agentTeamLlmEmpty: '当前没有模型提供方公布模型。',
  agentTeamLlmDefault: '默认路由',
  agentTeamLlmDefaultNone: '不使用默认路由',
  agentTeamLlmRoles: '按队友名称的预设路由',
  agentTeamLlmRolesEmpty: '没有预设路由。队友使用默认路由。',
  agentTeamLlmRoleName: '队友名称',
  agentTeamLlmRoleNamePlaceholder: '队友名称',
  agentTeamLlmRoleRoute: '路由',
  agentTeamLlmRoleRouteNone: '选择一条路由',
  agentTeamLlmRoleAdd: '添加预设',
  agentTeamLlmRoleRemove: '移除',
  agentTeamLlmConflict: '设置已在其他位置更新。请放弃修改后重试。',
  agentTeamLlmRequiredRoutes: '保存前请至少授权一条路由。',
  agentTeamLlmDefaultIncomplete: '默认路由必须同时提供提供方和模型，或者不设置默认路由。',
  agentTeamLlmRouteNotAllowed: '每个预设和默认路由都必须是已授权的路由之一。',
  agentTeamLlmRoleNameRequired: '每个预设都需要一个队友名称。',
  agentTeamLlmRoleNameDuplicate: '预设的队友名称不能重复。',
  agentTeamLlmRoleRouteRequired: '每个预设都需要一条路由。',
  agentTeamLlmScopeLabel: '设置作用域',
  agentTeamLlmScopeGlobal: '全局',
  agentTeamLlmScopeWorkspace: '工作区',
  agentTeamLlmWorkspaceLoading: '正在查找本工作区的团队文档…',
  agentTeamLlmWorkspaceUnavailable: '当前工作区没有项目根，因此没有可编辑的工作区团队文档。',
  agentTeamLlmWorkspaceNoWorkspace: '侧边栏还没有任何工作区，因此没有可编辑的工作区团队文档。',
  agentTeamLlmWorkspaceNoProjectRoot: '当前工作区不属于任何项目，因此没有可编辑的工作区团队文档。',
  agentTeamLlmWorkspaceLoadFailed: '无法读取团队文档。',
  agentTeamLlmWorkspaceSaveFailed: '团队文档没有被保存。',
  agentTeamLlmWorkspaceRetry: '重试',
  agentTeamLlmWorkspacePath: '团队文档',
  agentTeamLlmWorkspacePicker: '选择工作区',
  agentTeamLlmWorkspaceDefault: '默认工作区',
  agentTeamLlmMembers: '团队成员',
  agentTeamLlmMembersEmpty: '没有成员。队友使用上方的路由。',
  agentTeamLlmMemberName: '成员名称',
  agentTeamLlmMemberNamePlaceholder: 'lowercase-name',
  agentTeamLlmMemberDescription: '职责描述',
  agentTeamLlmMemberDescriptionPlaceholder: '这个成员负责什么',
  agentTeamLlmMemberPrompt: '开场指令',
  agentTeamLlmMemberPromptPlaceholder: '这个成员每次启动时的开场要求',
  agentTeamLlmMemberContext: '上下文',
  agentTeamLlmMemberContextFresh: '全新开始',
  agentTeamLlmMemberContextFork: '继承 Lead',
  agentTeamLlmMemberSandbox: '权限',
  agentTeamLlmMemberSandboxInherit: '随团队默认',
  agentTeamLlmMemberSandboxReadOnly: '只读',
  agentTeamLlmMemberSandboxWorkspaceWrite: '可写当前工作区',
  agentTeamLlmMemberSandboxFullAccess: '完全访问',
  agentTeamLlmMemberRoute: '成员路由',
  agentTeamLlmMemberRouteNone: '使用队友自己的路由',
  agentTeamLlmMemberAdd: '添加成员',
  agentTeamLlmMemberRemove: '移除',
  agentTeamLlmManualTitle: '手动添加路由',
  agentTeamLlmManualHint: '提供方没有在上方目录里公布时：填它的 provider 与 model，然后在上方列表里勾选授权。',
  agentTeamLlmRouteProvider: '提供方',
  agentTeamLlmRouteProviderPlaceholder: 'provider id',
  agentTeamLlmRouteModel: '模型',
  agentTeamLlmRouteModelPlaceholder: 'model id',
  agentTeamLlmRouteEffort: '推理强度',
  agentTeamLlmRouteEffortPlaceholder: '模型默认',
  agentTeamLlmRouteAdd: '添加路由',
  agentTeamLlmRouteRemove: '移除路由',
  agentTeamLlmRoleEffort: '预设推理强度',
  agentTeamLlmMemberNameRequired: '每个成员都需要名称。',
  agentTeamLlmMemberNameFormat: '成员名称只能是小写单词，单个连字符分隔。',
  agentTeamLlmMemberNameReserved: "名称 'lead' 属于会话的 Lead。",
  agentTeamLlmMemberNameDuplicate: '成员名称不能重复。',
  agentTeamLlmMemberDescriptionRequired: '每个成员都需要职责描述。',
  agentTeamLlmMemberRouteIncomplete: '成员路由必须同时提供提供方和模型。',
}

/**
 * The form frame's copy, read from this card's dictionary.
 * @param t - the card's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: AgentTeamLlmSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}

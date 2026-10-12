/**
 * The workspace team document the card edits: `<projectRoot>/.dsh/team.json`
 * over the Host `readTeamDocument` / `saveTeamDocument` Remotes, and the rules
 * of that document the Host validates on read and refuses a save for.
 */

// Type-only: the generated `agentTeamLlm` namespace this card calls, whose
// `WorkspaceFileScope` parameter arrives as the Session identity the Host
// resolves to a workspace root.
import type {} from '@deepseek-ai/dsh-experimental-agent-team-llm-settings/remote'
import type { TeamMemberPermissionCatalog } from '@deepseek-ai/dsh-experimental-agent-team-llm-settings'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentTeamLlmRoleRoute, AgentTeamLlmRoute } from './agent-team-llm-card-controller.ts'

/** Teammate name grammar the Host accepts in a workspace document. */
const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Name the Lead already owns; no workspace member may take it. */
const RESERVED_NAME = 'lead'

/** Sandbox scope one stored member may declare; the empty string inherits. */
export type MemberSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Approval policy one stored member may declare; the empty string inherits. */
export type MemberApprovalPolicy = 'ask' | 'never'

/** One workspace member as the Host stores it. */
export interface AgentTeamLlmTeamMember {
  /** Teammate name; unique in the document and never `lead`. */
  name: string
  /** What this member is for, as the Lead reads it. */
  description: string
  /** Prompt the Host prepends for this member; omission writes none. */
  prompt?: string
  /** Whether the member starts fresh or forks the Lead's context; default `fresh`. */
  context?: 'fresh' | 'fork'
  /** Sandbox the member runs in; omission keeps the team's own default. */
  sandboxMode?: MemberSandboxMode
  /** Approval policy the member runs under; omission keeps the team's own default. */
  approvalPolicy?: MemberApprovalPolicy
  /** Provider this member runs on; an omitted pair means the Lead's route. */
  provider?: string
  /** Model this member runs on; always paired with `provider`. */
  model?: string
  /** Adapter-owned reasoning effort stored with the member's route. */
  reasoningEffort?: string
}

/** The workspace team document; every field beyond `version` is optional. */
export interface AgentTeamLlmTeamDocument {
  /** Schema version the Host refuses to downgrade. */
  version: 1
  /** Whether the workspace routing applies. */
  enabled?: boolean
  /** Exact routes a workspace member may be routed to. */
  allowedRoutes?: readonly AgentTeamLlmRoute[]
  /** Per-teammate-name preset routes. */
  roleRoutes?: readonly AgentTeamLlmRoleRoute[]
  /** Provider of the workspace default route; empty with an empty model means none. */
  defaultProvider?: string
  /** Model of the workspace default route; empty with an empty provider means none. */
  defaultModel?: string
  /** The fixed team composition this project spawns. */
  members?: readonly AgentTeamLlmTeamMember[]
}

/**
 * One workspace document read. An absent `path` is the Host's answer that no
 * project root backs the scope, so the card has no workspace layer to edit.
 */
export interface AgentTeamLlmTeamDocumentRead {
  /** Absolute path of the document the Host edits. */
  path?: string
  /** The stored document; absent for a project that has none yet. */
  document?: AgentTeamLlmTeamDocument
}

/** One accepted workspace write. */
export interface AgentTeamLlmTeamDocumentWrite {
  /** Absolute path the Host wrote. */
  path: string
}

/** The Host `agentTeamLlm` Remote namespace this card calls, as its generated declarations carry it. */
export type AgentTeamLlmTeamDocuments = ClientRemote['agentTeamLlm']

/** Rules one member row would have the Host refuse a workspace save for. */
export type AgentTeamLlmMemberProblemKey =
  | 'agentTeamLlmMemberNameRequired'
  | 'agentTeamLlmMemberNameFormat'
  | 'agentTeamLlmMemberNameReserved'
  | 'agentTeamLlmMemberNameDuplicate'
  | 'agentTeamLlmMemberDescriptionRequired'
  | 'agentTeamLlmMemberRouteIncomplete'

/** One member row as the editor stages it. */
export interface AgentTeamLlmMemberDraft {
  /** Staged teammate name. */
  name: string
  /** Staged description. */
  description: string
  /** Staged opening instructions; the empty string writes none. */
  prompt: string
  /** Staged context inheritance. */
  context: 'fresh' | 'fork'
  /** Staged sandbox scope; the empty string inherits the team default. */
  sandboxMode: MemberSandboxMode | ''
  /** Staged approval policy; the empty string inherits the team default. */
  approvalPolicy: MemberApprovalPolicy | ''
  /** Staged route; empty provider and model mean the Lead's route. */
  route: AgentTeamLlmRoute
}

/** One staged member row with its own rules settled. */
export interface AgentTeamLlmMemberState extends AgentTeamLlmMemberDraft {
  /** Selected route key; the empty string means the member inherits the Lead's route. */
  key: string
  /**
   * Selected permissions option: the empty string inherits the team default, a
   * configured preset name is that preset, and the Host's derived value covers
   * every other pair. Until the Host answers with its catalog, a row declaring
   * knobs carries their machine pair so the selector can still show it.
   */
  permission: string
  /** Rules this row would have the Host refuse a save for; empty when it is accepted. */
  problems: readonly AgentTeamLlmMemberProblemKey[]
}

/**
 * An empty member row the editor appends.
 * @returns the draft row with every field at its inherit-or-empty default.
 */
export function emptyAgentTeamLlmMember(): AgentTeamLlmMemberDraft {
  return {
    name: '',
    description: '',
    prompt: '',
    context: 'fresh',
    sandboxMode: '',
    approvalPolicy: '',
    route: { provider: '', model: '' },
  }
}

/** Detach one stored member from the document it was decoded from. */
function copyMember(member: AgentTeamLlmTeamMember): AgentTeamLlmMemberDraft {
  return {
    name: member.name,
    description: member.description,
    prompt: member.prompt ?? '',
    context: member.context ?? 'fresh',
    sandboxMode: member.sandboxMode ?? '',
    approvalPolicy: member.approvalPolicy ?? '',
    route: {
      provider: member.provider ?? '',
      model: member.model ?? '',
      ...member.reasoningEffort === undefined ? {} : { reasoningEffort: member.reasoningEffort },
    },
  }
}

/**
 * The member rows a stored layer carries, in file order.
 * @param source - a workspace document, the global settings value, or nothing.
 * @returns one detached draft per stored member.
 */
export function agentTeamLlmMemberDrafts(
  source: { readonly members?: readonly AgentTeamLlmTeamMember[] } | null | undefined,
): AgentTeamLlmMemberDraft[] {
  return source?.members?.map(copyMember) ?? []
}

/**
 * One staged member as the Host document stores it.
 * @param draft - staged member row.
 * @returns the stored member, omitting every field the row leaves empty.
 */
export function agentTeamLlmTeamMemberOf(draft: AgentTeamLlmMemberDraft): AgentTeamLlmTeamMember {
  return {
    name: draft.name,
    description: draft.description,
    ...draft.prompt === '' ? {} : { prompt: draft.prompt },
    context: draft.context,
    ...draft.sandboxMode === '' ? {} : { sandboxMode: draft.sandboxMode },
    ...draft.approvalPolicy === '' ? {} : { approvalPolicy: draft.approvalPolicy },
    ...draft.route.provider === '' ? {} : {
      provider: draft.route.provider,
      model: draft.route.model,
      ...draft.route.reasoningEffort === undefined ? {} : { reasoningEffort: draft.route.reasoningEffort },
    },
  }
}

/**
 * Every document rule one member row breaks. The count cap the Host applies is
 * deployment configuration the card does not know, so it stays a Host refusal.
 * @param members - staged member rows in document order.
 * @returns the violated rules per row, aligned with `members`.
 */
export function agentTeamLlmMemberProblems(
  members: readonly AgentTeamLlmMemberDraft[],
): AgentTeamLlmMemberProblemKey[][] {
  return members.map(member => agentTeamLlmMemberProblem(member, members))
}

/**
 * The rules one staged member row breaks, read against its siblings.
 * @param member - the staged member row to check.
 * @param members - every staged row, which duplicate-name detection needs.
 * @returns the violated rules for `member`, empty when the Host would accept it.
 */
export function agentTeamLlmMemberProblem(
  member: AgentTeamLlmMemberDraft,
  members: readonly AgentTeamLlmMemberDraft[],
): AgentTeamLlmMemberProblemKey[] {
  const problems = new Set<AgentTeamLlmMemberProblemKey>()
  if (member.name === '') problems.add('agentTeamLlmMemberNameRequired')
  else if (!MEMBER_NAME.test(member.name)) problems.add('agentTeamLlmMemberNameFormat')
  if (member.name === RESERVED_NAME) problems.add('agentTeamLlmMemberNameReserved')
  if (member.description === '') problems.add('agentTeamLlmMemberDescriptionRequired')
  if (members.filter(sibling => sibling.name === member.name && member.name !== '').length > 1) {
    problems.add('agentTeamLlmMemberNameDuplicate')
  }
  if ((member.route.provider === '') !== (member.route.model === '')) {
    problems.add('agentTeamLlmMemberRouteIncomplete')
  }
  return [...problems]
}

/**
 * Which permissions option one member row selects.
 *
 * The selector binds one value while the document stores two knobs, so a row
 * declaring neither knob inherits, a row declaring exactly one configured
 * preset's pair selects that preset, and any other pair selects the Host's
 * derived value. Until the Host answers, a row declaring knobs carries their
 * machine pair, which no option matches and the selector shows as its own
 * disabled row rather than claiming an option the Host never confirmed.
 * @param member - member row carrying the two permission knobs.
 * @param catalog - permissions options the Host serves, or null before it answers.
 * @returns the option value the selector binds, or the row's machine pair.
 */
export function agentTeamLlmMemberPermission(
  member: Pick<AgentTeamLlmMemberDraft, 'sandboxMode' | 'approvalPolicy'>,
  catalog: TeamMemberPermissionCatalog | null,
): string {
  if (member.sandboxMode === '' && member.approvalPolicy === '') return ''
  const preset = catalog?.presets.find(entry => (
    entry.sandbox === member.sandboxMode && entry.approval === member.approvalPolicy
  ))
  if (preset !== undefined) return preset.name
  if (catalog !== null) return catalog.custom.name
  return `${member.sandboxMode}|${member.approvalPolicy}`
}

/**
 * The knobs one selected permissions option writes.
 *
 * Every option other than a configured preset writes neither knob, so the
 * member inherits the team default: the Host's derived value is a display state
 * that is never a switch target, and an option the Host no longer advertises
 * must not invent a pair.
 * @param name - selected option value, or the empty string for inherit.
 * @param catalog - permissions options the Host serves, or null before it answers.
 * @returns the two permission knobs to stage.
 */
export function agentTeamLlmMemberPermissionKnobs(
  name: string,
  catalog: TeamMemberPermissionCatalog | null,
): { sandboxMode: MemberSandboxMode | ''; approvalPolicy: MemberApprovalPolicy | '' } {
  const preset = catalog?.presets.find(entry => entry.name === name)
  return preset === undefined
    ? { sandboxMode: '', approvalPolicy: '' }
    : { sandboxMode: preset.sandbox, approvalPolicy: preset.approval }
}

/**
 * Whether two member rows would store the same member.
 * @param left - one staged member row.
 * @param right - the member row to compare against it.
 * @returns whether both rows would store identical member fields.
 */
export function sameAgentTeamLlmMember(
  left: AgentTeamLlmMemberDraft,
  right: AgentTeamLlmMemberDraft,
): boolean {
  return left.name === right.name
    && left.description === right.description
    && left.prompt === right.prompt
    && left.context === right.context
    && left.sandboxMode === right.sandboxMode
    && left.approvalPolicy === right.approvalPolicy
    && left.route.provider === right.route.provider
    && left.route.model === right.route.model
    && left.route.reasoningEffort === right.route.reasoningEffort
}

/**
 * Whether two member lists would store the same composition.
 * @param left - one staged member list.
 * @param right - the member list to compare against it.
 * @returns whether both lists hold the same rows in the same order.
 */
export function sameAgentTeamLlmMembers(
  left: readonly AgentTeamLlmMemberDraft[],
  right: readonly AgentTeamLlmMemberDraft[],
): boolean {
  return left.length === right.length && left.every((member, index) => {
    const other = right[index]
    return other !== undefined && sameAgentTeamLlmMember(member, other)
  })
}

/**
 * Which optional fields one workspace document declares. A field the document
 * omits inherits the global layer, so a save writes a field only when the
 * document already carried it or the user changed it away from what it inherits.
 */
export interface AgentTeamLlmDocumentScope {
  /** The document carries `enabled`. */
  enabled: boolean
  /** The document carries `allowedRoutes`. */
  allowedRoutes: boolean
  /** The document carries `roleRoutes`. */
  roleRoutes: boolean
  /** The document carries `members`. */
  members: boolean
}

/**
 * The complete workspace document a save writes. A field outside `declared` is
 * left out so the project keeps inheriting it, and an unset default route is
 * omitted as a whole because the Host reads a present field as a non-empty string.
 * @param draft - the staged routing document.
 * @param declared - which fields this project's document carries.
 * @returns the document to write.
 */
export function agentTeamLlmTeamDocumentOf(
  draft: {
    enabled: boolean
    allowedRoutes: readonly AgentTeamLlmRoute[]
    roleRoutes: readonly AgentTeamLlmRoleRoute[]
    defaultProvider: string
    defaultModel: string
    members: readonly AgentTeamLlmMemberDraft[]
  },
  declared: AgentTeamLlmDocumentScope,
): AgentTeamLlmTeamDocument {
  const hasDefaultRoute = draft.defaultProvider !== '' && draft.defaultModel !== ''
  return {
    version: 1,
    ...declared.enabled ? { enabled: draft.enabled } : {},
    ...declared.allowedRoutes ? { allowedRoutes: draft.allowedRoutes.map(route => ({ ...route })) } : {},
    ...declared.roleRoutes ? { roleRoutes: draft.roleRoutes.map(role => ({ ...role })) } : {},
    ...hasDefaultRoute
      ? { defaultProvider: draft.defaultProvider, defaultModel: draft.defaultModel }
      : {},
    ...declared.members ? { members: draft.members.map(agentTeamLlmTeamMemberOf) } : {},
  }
}

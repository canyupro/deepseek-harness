/** Staged editor for the two Team LLM routing documents: deployment settings and one project team document. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  SettingsFormPathOp, SettingsFormScope, SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the permissions options the Host `agentTeamLlm` Remote serves with
// the knob pair behind every configured preset.
import type { TeamMemberPermissionCatalog } from '@deepseek-ai/dsh-experimental-agent-team-llm-settings'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamLlmProblemKey } from './locales.ts'
import {
  agentTeamLlmMemberDrafts, agentTeamLlmMemberPermission, agentTeamLlmMemberPermissionKnobs,
  agentTeamLlmMemberProblem, agentTeamLlmMemberProblems,
  agentTeamLlmTeamDocumentOf, agentTeamLlmTeamMemberOf,
  emptyAgentTeamLlmMember, sameAgentTeamLlmMembers,
  type AgentTeamLlmDocumentScope, type AgentTeamLlmMemberDraft, type AgentTeamLlmMemberProblemKey,
  type AgentTeamLlmMemberState, type AgentTeamLlmTeamDocument, type AgentTeamLlmTeamDocuments,
  type AgentTeamLlmTeamMember,
} from './team-document.ts'

/**
 * Namespace of the Host-owned Team LLM routing document. Spelled here rather
 * than imported: a client package must not depend on a Host package.
 */
export const AGENT_TEAM_LLM_NS = 'agent-team-llm-settings'

/** Which of the two layers the card edits. */
export type AgentTeamLlmScopeKey = 'global' | 'workspace'

/** What the Host has answered about the workspace layer of the selected Session. */
export type AgentTeamLlmWorkspaceStatus = 'loading' | 'ready' | 'unavailable' | 'error'

/** Why the workspace layer has nothing to edit, when the card says so. */
export type AgentTeamLlmWorkspaceReason = 'noSession' | 'noProjectRoot'

/** One Session the Host offers as a possible workspace root for the card. */
export interface AgentTeamLlmWorkspaceCandidate {
  /** Session whose cwd the Host resolves a project root from. */
  sessionId: SessionId
  /** Working directory the Host reported for the Session. */
  cwd: string
  /**
   * Creation time of the Session header; the Host ranks candidates by it and
   * returns them newest first. When a Session was last used belongs to the GUI
   * API's session-list projection, which a headless composition does not mount,
   * so a long-used older Session can rank below a newer one.
   */
  createdAt: number
}

/** The workspace layer as the card knows it. */
export interface AgentTeamLlmWorkspaceState {
  /** Whether a project root backs the layer, is still being asked, or refused the read. */
  status: AgentTeamLlmWorkspaceStatus
  /** Absolute path of the document the Host edits, once it answered one. */
  path: string | undefined
  /** Host refusal text of the last read or write; empty while the layer answers. */
  error: string | undefined
  /**
   * Which side of the boundary an unavailable layer stopped at: the client found
   * no session to resolve, or the Host resolved that session to no project root.
   */
  reason: AgentTeamLlmWorkspaceReason | undefined
  /** Whether the Host has been asked for the sessions it can offer as workspaces. */
  candidatesStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Sessions the Host offered, newest first; empty until it answers. */
  candidates: readonly AgentTeamLlmWorkspaceCandidate[]
  /** The Session the layer resolves; undefined while none does. */
  sessionId: SessionId | undefined
}

/** One exact provider/model route as the Host stores it. */
export interface AgentTeamLlmRoute {
  /** Registered LLM provider id. */
  provider: string
  /** Provider-owned exact model id. */
  model: string
  /**
   * Adapter-owned reasoning effort the Host stored for this route. The empty
   * string clears it and the route then uses the model default; a route keeps
   * its stored effort while its provider and model are unchanged.
   */
  reasoningEffort?: string
}

/** One teammate-name preset route as the Host stores it. */
export interface AgentTeamLlmRoleRoute extends AgentTeamLlmRoute {
  /** Teammate name this preset applies to. */
  name: string
}

/** The Team LLM routing document this card edits. */
export interface AgentTeamLlmSettings {
  /** Whether the configured routes apply to newly composed teammates. */
  enabled: boolean
  /** Exact routes a teammate may be routed to. */
  allowedRoutes: AgentTeamLlmRoute[]
  /** Per-teammate-name preset routes. */
  roleRoutes: AgentTeamLlmRoleRoute[]
  /** Provider of the default route; the empty string means no default route. */
  defaultProvider: string
  /** Model of the default route; the empty string means no default route. */
  defaultModel: string
  /** Fixed roster this layer declares; omission contributes no member. */
  members?: AgentTeamLlmTeamMember[]
}

/** One catalog row joined with a stored route the catalog may no longer advertise. */
export interface AgentTeamLlmCandidate extends AgentTeamLlmRoute {
  /** Stable opaque identity used only for lookup. */
  key: string
  /** Adapter-owned provider display name. */
  providerName: string
  /** Adapter-owned model display name. */
  modelName: string
  /** Whether the current adapter catalog advertises this exact route. */
  available: boolean
  /** Whether the current draft authorizes this route. */
  selected: boolean
}

/** One preset row as the editor renders it. */
export interface AgentTeamLlmRoleState {
  /** Draft teammate name. */
  name: string
  /** Selected route key; the empty string means no route is chosen yet. */
  key: string
  /** Route fields a save writes for this preset. */
  route: AgentTeamLlmRoute
}

/** State rendered by the staged Team LLM routing card. */
export interface AgentTeamLlmCardState extends SettingsFormShell {
  /** Which layer the controls below edit. */
  scope: AgentTeamLlmScopeKey
  /** What the Host has answered about the workspace layer. */
  workspace: AgentTeamLlmWorkspaceState
  /** Whether the draft enables configured teammate routing. */
  enabled: boolean
  /** Live catalog joined with stored routes. */
  candidates: readonly AgentTeamLlmCandidate[]
  /** Authorized routes in catalog order; the default, preset, and member controls draw from these. */
  allowed: readonly AgentTeamLlmCandidate[]
  /** Draft default route; empty provider and model mean no default route. */
  defaultRoute: AgentTeamLlmRoute
  /** Draft preset rows. */
  roles: readonly AgentTeamLlmRoleState[]
  /** Draft members of the selected layer; both layers carry a fixed composition. */
  members: readonly AgentTeamLlmMemberState[]
  /** Adapter-directory request state. */
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Whether any provider-local catalog request failed. */
  catalogPartial: boolean
  /**
   * Permissions options the Host serves for a member row, or null before it
   * answers. The Host derives them from the composed permission presets, so a
   * member row shows a configured preset's name instead of a raw knob pair.
   */
  memberPermissions: TeamMemberPermissionCatalog | null
  /** Whether a newer Host revision invalidated the current draft. */
  conflicted: boolean
  /** Every routing rule the draft would violate; empty when a save may proceed. */
  problems: readonly AgentTeamLlmProblemKey[]
}

/** Registration-side face for the Team LLM routing card. */
export interface AgentTeamLlmCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useAgentTeamLlmCard. */
    agentTeamLlmCard: SnapshotStore<AgentTeamLlmCardState>
  }
  /** Edit one layer; the workspace layer refuses the switch until the Host answers a read. */
  setScope: (scope: AgentTeamLlmScopeKey) => void
  /** Stage the enabled state. */
  toggleEnabled: () => void
  /** Stage one exact route as authorized or unauthorized. */
  toggleRoute: (key: string) => void
  /** Authorize one hand-filled route; an incomplete or already authorized pair stages nothing. */
  addAllowedRoute: (provider: string, model: string) => void
  /** Drop one authorized route, leaving any preset that names it to fail validation. */
  removeAllowedRoute: (key: string) => void
  /** Stage one authorized route's reasoning effort; the empty string clears it. */
  setRouteEffort: (key: string, reasoningEffort: string) => void
  /** Stage the default route, or no default route for the empty key. */
  setDefaultRoute: (key: string) => void
  /** Append an empty preset row. */
  addRole: () => void
  /** Drop one preset row. */
  removeRole: (index: number) => void
  /** Stage one preset's teammate name. */
  setRoleName: (index: number, name: string) => void
  /** Stage one preset's route. */
  setRoleRoute: (index: number, key: string) => void
  /** Stage one preset's reasoning effort; the empty string clears it. */
  setRoleEffort: (index: number, reasoningEffort: string) => void
  /** Append an empty member row to the selected layer. */
  addMember: () => void
  /** Drop one member row of the selected layer. */
  removeMember: (index: number) => void
  /** Stage one member's teammate name. */
  setMemberName: (index: number, name: string) => void
  /** Stage one member's description. */
  setMemberDescription: (index: number, description: string) => void
  /** Stage one member's opening instructions; the empty string writes none. */
  setMemberPrompt: (index: number, prompt: string) => void
  /** Stage whether a member starts fresh or forks the Lead's context. */
  setMemberContext: (index: number, context: 'fresh' | 'fork') => void
  /** Stage one member's permissions option; the empty string inherits the team default. */
  setMemberPermissions: (index: number, name: string) => void
  /** Stage one member's route, or no route for the empty key. */
  setMemberRoute: (index: number, key: string) => void
  /** Stage one member's route by hand; two empty strings clear it, a half pair fails validation. */
  setMemberRouteFields: (index: number, provider: string, model: string) => void
  /** Stage one member's reasoning effort; the empty string clears it. */
  setMemberEffort: (index: number, reasoningEffort: string) => void
  /** Retry the adapter directory. */
  retryCatalog: () => void
  /** Read the workspace document again after a refusal or a new Session scope. */
  retryWorkspace: () => void
  /** Resolve the workspace layer from one offered Session, dropping any staged workspace draft. */
  setWorkspaceSession: (sessionId: SessionId) => void
  /** Persist every staged field as one revision-fenced mutation. */
  save: () => void
  /** Drop the staged routing document. */
  discard: () => void
}

/** The routing fields both layers share. */
interface AgentTeamLlmRouting {
  enabled: boolean
  allowed: Map<string, AgentTeamLlmRoute>
  defaultProvider: string
  defaultModel: string
  roles: AgentTeamLlmRoleState[]
  members: AgentTeamLlmMemberDraft[]
}

/** One layer's staged document. */
interface AgentTeamLlmDraft extends AgentTeamLlmRouting {
  /** Settings revision the draft was staged against; absent in the workspace layer. */
  revision: number | undefined
}

/**
 * Stable identity for one exact route; callers resolve it by lookup and never parse it.
 * @param route - Provider/model route to identify.
 * @returns Opaque key for lookup within the card.
 */
export function agentTeamLlmRouteKey(route: { provider: string; model: string }): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Read back the provider and model an opaque route key carries.
 * @param key - Key produced by {@link agentTeamLlmRouteKey}, or the empty string.
 * @returns The route fields, with empty strings for a key that carries none.
 */
function agentTeamLlmRouteFromKey(key: string): AgentTeamLlmRoute {
  const separator = key.indexOf('\0')
  if (separator < 0) return { provider: key, model: '' }
  return { provider: key.slice(0, separator), model: key.slice(separator + 1) }
}

/**
 * Detach one route from the section it was decoded into.
 * @param route - Route read from the Host document.
 * @returns A copy carrying the same fields, omitting an absent reasoning effort.
 */
function copyRoute(route: AgentTeamLlmRoute): AgentTeamLlmRoute {
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
  }
}

/**
 * Join live adapter metadata with stored routes that remain removable after disappearance.
 * @param groups - Current model directory grouped by provider.
 * @param stored - Routes in the effective settings value.
 * @param selected - Opaque route keys authorized in the current draft.
 * @returns Candidate rows for the card.
 */
export function agentTeamLlmCandidates(
  groups: readonly ModelProviderGroup[],
  stored: readonly AgentTeamLlmRoute[],
  selected: ReadonlySet<string>,
): AgentTeamLlmCandidate[] {
  const storedByKey = new Map(stored.map(route => [agentTeamLlmRouteKey(route), route]))
  const candidates = groups.flatMap(group => group.models.map((model): AgentTeamLlmCandidate => {
    const route = { provider: group.id, model: model.id }
    const key = agentTeamLlmRouteKey(route)
    // A stored route keeps its effort visible while the catalog still advertises it.
    const stored = storedByKey.get(key)
    storedByKey.delete(key)
    return {
      ...copyRoute(stored ?? route),
      key,
      providerName: group.name,
      modelName: model.name,
      available: true,
      selected: selected.has(key),
    }
  }))
  for (const route of storedByKey.values()) {
    const key = agentTeamLlmRouteKey(route)
    candidates.push({
      ...copyRoute(route),
      key,
      providerName: route.provider,
      modelName: route.model,
      available: false,
      selected: selected.has(key),
    })
  }
  return candidates
}

/**
 * One route with its reasoning effort set; the empty string drops the field so
 * the route uses the model default again.
 * @param route - Route whose identity is kept.
 * @param reasoningEffort - Effort to store, or the empty string to store none.
 * @returns a new route carrying the requested effort.
 */
function withEffort(route: AgentTeamLlmRoute, reasoningEffort: string): AgentTeamLlmRoute {
  return reasoningEffort === ''
    ? { provider: route.provider, model: route.model }
    : { provider: route.provider, model: route.model, reasoningEffort }
}

function sameRoutes(left: readonly AgentTeamLlmRoute[], right: readonly AgentTeamLlmRoute[]): boolean {
  if (left.length !== right.length) return false
  const rightByKey = new Map(right.map(route => [agentTeamLlmRouteKey(route), route]))
  return left.every((route) => {
    const other = rightByKey.get(agentTeamLlmRouteKey(route))
    return other !== undefined && other.reasoningEffort === route.reasoningEffort
  })
}

function sameRoles(left: readonly AgentTeamLlmRoleRoute[], right: readonly AgentTeamLlmRoleRoute[]): boolean {
  return left.length === right.length && left.every((role, index) => {
    const other = right[index]
    return other !== undefined
      && role.name === other.name
      && agentTeamLlmRouteKey(role) === agentTeamLlmRouteKey(other)
      && role.reasoningEffort === other.reasoningEffort
  })
}

function sameRouting(left: AgentTeamLlmRouting, right: AgentTeamLlmRouting): boolean {
  return left.enabled === right.enabled
    && left.defaultProvider === right.defaultProvider
    && left.defaultModel === right.defaultModel
    && sameRoutes([...left.allowed.values()], [...right.allowed.values()])
    && sameRoles(
      left.roles.map(role => ({ ...copyRoute(role.route), name: role.name })),
      right.roles.map(role => ({ ...copyRoute(role.route), name: role.name })),
    )
}

/**
 * Every Host rule a document would violate. Mirrors the Host: the schema rejects
 * an empty preset name and an empty preset route in any document, while route
 * membership and the non-empty allowlist apply only to an enabled document.
 * @param document - Routing document to check.
 * @returns The violated rules in report order; empty when the Host would accept it.
 */
function problemsOf(document: AgentTeamLlmRouting): AgentTeamLlmProblemKey[] {
  const problems = new Set<AgentTeamLlmProblemKey>()
  if ((document.defaultProvider === '') !== (document.defaultModel === '')) {
    problems.add('agentTeamLlmDefaultIncomplete')
  }
  const names = new Set<string>()
  for (const role of document.roles) {
    if (role.name === '') problems.add('agentTeamLlmRoleNameRequired')
    if (names.has(role.name)) problems.add('agentTeamLlmRoleNameDuplicate')
    names.add(role.name)
    if (role.route.provider === '' || role.route.model === '') problems.add('agentTeamLlmRoleRouteRequired')
  }
  if (!document.enabled) return [...problems]
  if (document.allowed.size === 0) problems.add('agentTeamLlmRequiredRoutes')
  for (const route of [...document.roles.map(role => role.route), {
    provider: document.defaultProvider, model: document.defaultModel,
  }]) {
    if (route.provider !== '' && route.model !== ''
      && !document.allowed.has(agentTeamLlmRouteKey(route))) {
      problems.add('agentTeamLlmRouteNotAllowed')
    }
  }
  return [...problems]
}

/** Bridges one configuration form, the live adapter directory, and the workspace document onto a staged card. */
export class AgentTeamLlmCardController {
  private catalogGroups: readonly ModelProviderGroup[] = []
  private catalogPartial = false
  private catalogStatus: AgentTeamLlmCardState['catalogStatus'] = 'idle'
  private memberPermissions: TeamMemberPermissionCatalog | null = null
  private memberPermissionsGeneration = 0
  private activeScope: AgentTeamLlmScopeKey = 'global'
  private readonly drafts = new Map<AgentTeamLlmScopeKey, AgentTeamLlmDraft>()
  private workspaceDocument: AgentTeamLlmTeamDocument | undefined
  private workspacePath: string | undefined
  private workspaceStatus: AgentTeamLlmWorkspaceStatus = 'loading'
  private workspaceError: string | undefined
  private workspaceReason: AgentTeamLlmWorkspaceReason | undefined
  private workspaceCandidates: readonly AgentTeamLlmWorkspaceCandidate[] = []
  private workspaceCandidatesStatus: AgentTeamLlmWorkspaceState['candidatesStatus'] = 'idle'
  private selectedSession: SessionId | undefined
  private resolvedSession: SessionId | undefined
  private readingWorkspace = false
  private saving = false
  private failed = false
  private conflicted = false
  private disposed = false
  private saveGeneration = 0
  private catalogGeneration = 0
  private workspaceGeneration = 0
  private candidatesGeneration = 0
  private readonly lifetime = new AbortController()
  private readonly store: SnapshotStore<AgentTeamLlmCardState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - bound `agent-team-llm-settings` configuration form.
   * @param ctx - the card plugin's context, whose `remote.session` namespace
   * answers the Host model catalog.
   * @param documents - the Host `agentTeamLlm` Remote slice reading and writing
   * the workspace team document.
   * @param workspaceSession - reader for the Session whose workspace root backs
   * the workspace layer; undefined while no Session project is open.
   */
  constructor(
    private readonly scope: SettingsFormScope<AgentTeamLlmSettings>,
    private readonly ctx: ClientContext,
    private readonly documents: AgentTeamLlmTeamDocuments,
    private readonly workspaceSession: () => SessionId | undefined,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => {
      const draft = this.drafts.get('global')
      if (!this.saving && draft !== undefined
        && this.scope.getSnapshot().revision !== draft.revision) {
        if (sameRouting(this.globalRouting(), this.desiredRouting('global'))) this.drafts.delete('global')
        else this.conflicted = true
      }
      this.publish()
    })
    // The default and preset controls render while routing is disabled too, so
    // their route choices need the directory without waiting for the switch.
    void this.loadCatalog()
    // A member row states its permissions as a preset name, so the options must
    // be known before the first row renders.
    void this.loadMemberPermissions()
    // The workspace tab states whether a project root exists before it is
    // clicked, so the read starts with the card rather than on the first switch.
    void this.loadWorkspace()
  }

  /** Stop observing settings and suppress late directory/read/write settlements. */
  dispose(): void {
    this.disposed = true
    this.saveGeneration += 1
    this.catalogGeneration += 1
    this.memberPermissionsGeneration += 1
    this.workspaceGeneration += 1
    this.candidatesGeneration += 1
    this.lifetime.abort(new Error('client-ui-agent-team-llm-settings: card disposed'))
    this.unsubscribe()
  }

  /**
   * Build the renderer face for this card.
   * @returns The snapshot and staged card actions injected into the renderer.
   */
  inject(): AgentTeamLlmCardFace {
    return {
      hooks: { agentTeamLlmCard: this.store },
      setScope: (scope) => { this.setScope(scope) },
      toggleEnabled: () => { this.toggleEnabled() },
      toggleRoute: (key) => { this.toggleRoute(key) },
      addAllowedRoute: (provider, model) => { this.addAllowedRoute(provider, model) },
      removeAllowedRoute: (key) => { this.removeAllowedRoute(key) },
      setRouteEffort: (key, reasoningEffort) => { this.setRouteEffort(key, reasoningEffort) },
      setDefaultRoute: (key) => { this.setDefaultRoute(key) },
      addRole: () => { this.addRole() },
      removeRole: (index) => { this.removeRole(index) },
      setRoleName: (index, name) => { this.setRoleName(index, name) },
      setRoleRoute: (index, key) => { this.setRoleRoute(index, key) },
      setRoleEffort: (index, reasoningEffort) => { this.setRoleEffort(index, reasoningEffort) },
      addMember: () => { this.addMember() },
      removeMember: (index) => { this.removeMember(index) },
      setMemberName: (index, name) => { this.setMemberName(index, name) },
      setMemberDescription: (index, description) => { this.setMemberDescription(index, description) },
      setMemberPrompt: (index, prompt) => { this.setMemberPrompt(index, prompt) },
      setMemberContext: (index, context) => { this.setMemberContext(index, context) },
      setMemberPermissions: (index, name) => { this.setMemberPermissions(index, name) },
      setMemberRoute: (index, key) => { this.setMemberRoute(index, key) },
      setMemberRouteFields: (index, provider, model) => { this.setMemberRouteFields(index, provider, model) },
      setMemberEffort: (index, reasoningEffort) => { this.setMemberEffort(index, reasoningEffort) },
      retryCatalog: () => { void this.loadCatalog() },
      retryWorkspace: () => { void this.loadWorkspace() },
      setWorkspaceSession: (sessionId) => { this.setWorkspaceSession(sessionId) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /** The deployment settings document the Host currently serves. */
  private globalRouting(): AgentTeamLlmRouting {
    const value = this.scope.getSnapshot().value
    return {
      enabled: value?.enabled ?? false,
      allowed: new Map((value?.allowedRoutes ?? []).map(route => [agentTeamLlmRouteKey(route), copyRoute(route)])),
      defaultProvider: value?.defaultProvider ?? '',
      defaultModel: value?.defaultModel ?? '',
      roles: (value?.roleRoutes ?? []).map(role => ({
        name: role.name,
        key: agentTeamLlmRouteKey(role),
        route: copyRoute(role),
      })),
      members: agentTeamLlmMemberDrafts(value),
    }
  }

  /**
   * The workspace document the Host last answered, overlaid on the global layer:
   * a field the project document omits inherits the deployment value, so the
   * editor shows what actually applies and a save can leave the field out.
   */
  private workspaceRouting(): AgentTeamLlmRouting {
    const document = this.workspaceDocument
    const inherited = this.globalRouting()
    return {
      enabled: document?.enabled ?? inherited.enabled,
      allowed: new Map((document?.allowedRoutes ?? [...inherited.allowed.values()])
        .map(route => [agentTeamLlmRouteKey(route), copyRoute(route)] as const)),
      defaultProvider: document?.defaultProvider ?? inherited.defaultProvider,
      defaultModel: document?.defaultModel ?? inherited.defaultModel,
      roles: (document?.roleRoutes ?? inherited.roles.map(role => ({ ...copyRoute(role.route), name: role.name })))
        .map(role => ({
          name: role.name,
          key: agentTeamLlmRouteKey(role),
          route: copyRoute(role),
        })),
      members: document?.members === undefined
        ? inherited.members
        : agentTeamLlmMemberDrafts(document),
    }
  }

  /**
   * Which optional fields a workspace save writes. A field the project document
   * already carried stays writable, and any field the draft moved away from what
   * it inherits becomes a declared override; everything else keeps inheriting.
   */
  private documentScope(routing: AgentTeamLlmRouting): AgentTeamLlmDocumentScope {
    const stored = this.workspaceDocument
    const inherited = this.globalRouting()
    return {
      enabled: stored?.enabled !== undefined || routing.enabled !== inherited.enabled,
      allowedRoutes: stored?.allowedRoutes !== undefined
        || !sameRoutes([...routing.allowed.values()], [...inherited.allowed.values()]),
      roleRoutes: stored?.roleRoutes !== undefined
        || !sameRoles(
          routing.roles.map(role => ({ ...copyRoute(role.route), name: role.name })),
          inherited.roles.map(role => ({ ...copyRoute(role.route), name: role.name })),
        ),
      members: stored?.members !== undefined || !sameAgentTeamLlmMembers(routing.members, inherited.members),
    }
  }

  private baseRouting(scope: AgentTeamLlmScopeKey): AgentTeamLlmRouting {
    return scope === 'global' ? this.globalRouting() : this.workspaceRouting()
  }

  private beginDraft(scope: AgentTeamLlmScopeKey): AgentTeamLlmDraft {
    const staged = this.drafts.get(scope)
    if (staged !== undefined) return staged
    const base = this.baseRouting(scope)
    const draft: AgentTeamLlmDraft = {
      enabled: base.enabled,
      allowed: base.allowed,
      defaultProvider: base.defaultProvider,
      defaultModel: base.defaultModel,
      roles: base.roles.map(role => ({ ...role, route: copyRoute(role.route) })),
      members: base.members.map(member => ({ ...member, route: copyRoute(member.route) })),
      revision: scope === 'global' ? this.scope.getSnapshot().revision : undefined,
    }
    this.drafts.set(scope, draft)
    return draft
  }

  /** Staged routing of one layer, or the accepted document where nothing is staged. */
  private desiredRouting(scope: AgentTeamLlmScopeKey): AgentTeamLlmRouting {
    return this.drafts.get(scope) ?? this.baseRouting(scope)
  }

  private selected(scope: AgentTeamLlmScopeKey): Set<string> {
    return new Set(this.desiredRouting(scope).allowed.keys())
  }

  private candidates(): AgentTeamLlmCandidate[] {
    const routing = this.desiredRouting(this.activeScope)
    return agentTeamLlmCandidates(this.catalogGroups, [...routing.allowed.values()], this.selected(this.activeScope))
  }

  /** Route fields one chosen key stands for, preferring the authorized route it names. */
  private routeForKey(key: string): AgentTeamLlmRoute {
    if (key === '') return { provider: '', model: '' }
    const allowed = this.desiredRouting(this.activeScope).allowed.get(key)
    return allowed === undefined ? agentTeamLlmRouteFromKey(key) : copyRoute(allowed)
  }

  /** Whether the active layer may be edited at all. */
  private editable(): boolean {
    if (this.disposed || this.saving || !this.scope.getSnapshot().writable) return false
    return this.activeScope === 'global' || this.workspaceStatus === 'ready'
  }

  private setScope(scope: AgentTeamLlmScopeKey): void {
    if (this.disposed || this.saving || scope === this.activeScope) return
    if (scope === 'workspace' && this.workspaceStatus !== 'ready') return
    this.activeScope = scope
    this.dropConflicted()
    this.publish()
  }

  private toggleEnabled(): void {
    if (!this.editable()) return
    const draft = this.beginDraft(this.activeScope)
    draft.enabled = !draft.enabled
    this.dropConflicted()
    this.publish()
  }

  private toggleRoute(key: string): void {
    if (!this.editable()) return
    const candidate = this.candidates().find(entry => entry.key === key)
    if (candidate === undefined) return
    const draft = this.beginDraft(this.activeScope)
    if (draft.allowed.has(key)) draft.allowed.delete(key)
    else draft.allowed.set(key, copyRoute(candidate))
    this.dropConflicted()
    this.publish()
  }

  /**
   * Authorize a route the user typed, for a provider and model the live catalog
   * does not advertise. A half-filled pair stages nothing, because an authorized
   * route is an identity the Host resolves later.
   * @param provider - Provider id to authorize.
   * @param model - Model id to authorize.
   */
  private addAllowedRoute(provider: string, model: string): void {
    if (!this.editable() || provider === '' || model === '') return
    const key = agentTeamLlmRouteKey({ provider, model })
    const draft = this.beginDraft(this.activeScope)
    if (draft.allowed.has(key)) return
    draft.allowed.set(key, { provider, model })
    this.dropConflicted()
    this.publish()
  }

  /**
   * Drop one authorized route. Presets and the default route that name it keep
   * their own fields, so they fall to `agentTeamLlmRouteNotAllowed` until the
   * user repoints them.
   * @param key - Route key to drop.
   */
  private removeAllowedRoute(key: string): void {
    if (!this.editable()) return
    const draft = this.beginDraft(this.activeScope)
    if (!draft.allowed.delete(key)) return
    this.dropConflicted()
    this.publish()
  }

  /**
   * Stage one authorized route's reasoning effort.
   * @param key - Route key to edit.
   * @param reasoningEffort - Effort to store; the empty string uses the model default.
   */
  private setRouteEffort(key: string, reasoningEffort: string): void {
    if (!this.editable()) return
    const route = this.beginDraft(this.activeScope).allowed.get(key)
    if (route === undefined) return
    this.beginDraft(this.activeScope).allowed.set(key, withEffort(route, reasoningEffort))
    this.dropConflicted()
    this.publish()
  }

  private setDefaultRoute(key: string): void {
    if (!this.editable()) return
    const route = this.routeForKey(key)
    const draft = this.beginDraft(this.activeScope)
    draft.defaultProvider = route.provider
    draft.defaultModel = route.model
    this.dropConflicted()
    this.publish()
  }

  private addRole(): void {
    if (!this.editable()) return
    this.beginDraft(this.activeScope).roles.push({ name: '', key: '', route: { provider: '', model: '' } })
    this.dropConflicted()
    this.publish()
  }

  private removeRole(index: number): void {
    if (!this.editable()) return
    const draft = this.beginDraft(this.activeScope)
    if (draft.roles[index] === undefined) return
    draft.roles.splice(index, 1)
    this.dropConflicted()
    this.publish()
  }

  /**
   * One staged preset of the selected layer, ready to mutate.
   * @param index - row index in the staged presets.
   * @returns the row, or undefined when it is gone or the card may not edit.
   */
  private stagedRole(index: number): AgentTeamLlmRoleState | undefined {
    if (!this.editable()) return undefined
    return this.beginDraft(this.activeScope).roles[index]
  }

  private setRoleName(index: number, name: string): void {
    const role = this.stagedRole(index)
    if (role === undefined) return
    role.name = name
    this.dropConflicted()
    this.publish()
  }

  private setRoleRoute(index: number, key: string): void {
    const role = this.stagedRole(index)
    if (role === undefined) return
    role.key = key
    role.route = this.routeForKey(key)
    this.dropConflicted()
    this.publish()
  }

  /**
   * Stage one preset's reasoning effort. The workspace document does not store
   * one, so the editor offers no control there; a value staged by any other
   * route survives nowhere and is dropped when that layer is saved.
   * @param index - preset row index.
   * @param reasoningEffort - Effort to store; the empty string uses the model default.
   */
  private setRoleEffort(index: number, reasoningEffort: string): void {
    const role = this.stagedRole(index)
    if (role === undefined) return
    role.route = withEffort(role.route, reasoningEffort)
    this.dropConflicted()
    this.publish()
  }

  private addMember(): void {
    if (!this.editable()) return
    this.beginDraft(this.activeScope).members.push(emptyAgentTeamLlmMember())
    this.dropConflicted()
    this.publish()
  }

  private removeMember(index: number): void {
    if (!this.editable()) return
    const draft = this.beginDraft(this.activeScope)
    if (draft.members[index] === undefined) return
    draft.members.splice(index, 1)
    this.dropConflicted()
    this.publish()
  }

  /**
   * One staged member of the selected layer, ready to mutate.
   * @param index - row index in the staged composition.
   * @returns the row, or undefined when it is gone or the card may not edit.
   */
  private stagedMember(index: number): AgentTeamLlmMemberDraft | undefined {
    if (!this.editable()) return undefined
    return this.beginDraft(this.activeScope).members[index]
  }

  private setMemberName(index: number, name: string): void {
    const member = this.stagedMember(index)
    if (member === undefined) return
    member.name = name
    this.dropConflicted()
    this.publish()
  }

  private setMemberDescription(index: number, description: string): void {
    const member = this.stagedMember(index)
    if (member === undefined) return
    member.description = description
    this.dropConflicted()
    this.publish()
  }

  private setMemberPrompt(index: number, prompt: string): void {
    const member = this.stagedMember(index)
    if (member === undefined) return
    member.prompt = prompt
    this.dropConflicted()
    this.publish()
  }

  private setMemberContext(index: number, context: 'fresh' | 'fork'): void {
    const member = this.stagedMember(index)
    if (member === undefined) return
    member.context = context
    this.dropConflicted()
    this.publish()
  }

  private setMemberPermissions(index: number, name: string): void {
    const member = this.stagedMember(index)
    if (member === undefined) return
    const knobs = agentTeamLlmMemberPermissionKnobs(name, this.memberPermissions)
    member.sandboxMode = knobs.sandboxMode
    member.approvalPolicy = knobs.approvalPolicy
    this.dropConflicted()
    this.publish()
  }

  private setMemberRoute(index: number, key: string): void {
    const member = this.stagedMember(index)
    if (member === undefined) return
    member.route = this.routeForKey(key)
    this.dropConflicted()
    this.publish()
  }

  /**
   * Stage one member's route by hand. Clearing both fields drops the route, and
   * a half-filled pair is staged so `agentTeamLlmMemberRouteIncomplete` reports
   * it rather than the card hiding the mistake.
   * @param index - member row index.
   * @param provider - Provider id, or the empty string to clear.
   * @param model - Model id, or the empty string to clear.
   */
  private setMemberRouteFields(index: number, provider: string, model: string): void {
    const member = this.stagedMember(index)
    if (member === undefined) return
    const cleared = provider === '' && model === ''
    member.route = {
      provider,
      model,
      ...cleared || member.route.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: member.route.reasoningEffort },
    }
    this.dropConflicted()
    this.publish()
  }

  /**
   * Stage one member's reasoning effort. A member's route stores one in both
   * layers, so unlike a preset's this control is offered everywhere.
   * @param index - member row index.
   * @param reasoningEffort - Effort to store; the empty string uses the model default.
   */
  private setMemberEffort(index: number, reasoningEffort: string): void {
    const member = this.stagedMember(index)
    if (member === undefined) return
    member.route = withEffort(member.route, reasoningEffort)
    this.dropConflicted()
    this.publish()
  }

  private dropConflicted(): void {
    this.failed = false
    this.conflicted = false
    if (this.activeScope === 'workspace') this.workspaceError = undefined
  }

  private discard(): void {
    if (this.saving) return
    this.drafts.delete(this.activeScope)
    this.dropConflicted()
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const routing = this.desiredRouting(this.activeScope)
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving
      || problemsOf(routing).length > 0 || this.memberProblems().some(row => row.length > 0)
      || !this.dirty(routing)) return
    if (this.activeScope === 'workspace') {
      await this.saveWorkspace(routing)
      return
    }
    const draft = this.drafts.get('global')
    if (draft !== undefined && snapshot.revision !== draft.revision) {
      this.conflicted = true
      this.publish()
      return
    }
    const generation = this.saveGeneration
    this.saving = true
    this.dropConflicted()
    this.publish()
    await this.scope.mutate(this.opsFor(routing), draft?.revision)
    if (generation !== this.saveGeneration) return
    const landed = sameRouting(this.globalRouting(), routing)
    this.saving = false
    this.failed = !landed
    if (landed) this.drafts.delete('global')
    this.publish()
  }

  /** Persist the staged workspace document as one Host write. */
  private async saveWorkspace(routing: AgentTeamLlmRouting): Promise<void> {
    const sessionId = this.currentSession()
    if (sessionId === undefined || this.workspaceStatus !== 'ready') return
    const generation = this.saveGeneration
    const document = agentTeamLlmTeamDocumentOf({
      enabled: routing.enabled,
      allowedRoutes: [...routing.allowed.values()].map(copyRoute),
      roleRoutes: routing.roles.map(role => ({ ...copyRoute(role.route), name: role.name })),
      defaultProvider: routing.defaultProvider,
      defaultModel: routing.defaultModel,
      members: routing.members,
    }, this.documentScope(routing))
    this.saving = true
    this.dropConflicted()
    this.publish()
    const result = await this.documents.saveTeamDocument(sessionId, document, this.lifetime.signal)
    if (generation !== this.saveGeneration) return
    this.saving = false
    if (result.ok) {
      this.workspaceDocument = document
      this.workspacePath = result.value.path
      this.drafts.delete('workspace')
      this.failed = false
      this.workspaceError = undefined
    } else {
      this.failed = true
      this.workspaceError = result.error.message
    }
    this.publish()
  }

  /** Member rules of the selected layer's staged composition, aligned with its rows. */
  private memberProblems(): AgentTeamLlmMemberProblemKey[][] {
    return agentTeamLlmMemberProblems(this.desiredRouting(this.activeScope).members)
  }

  /** Whether a save would write a document different from the accepted one. */
  private dirty(routing: AgentTeamLlmRouting): boolean {
    const base = this.baseRouting(this.activeScope)
    return !sameRouting(base, routing)
      || !sameAgentTeamLlmMembers(base.members, routing.members)
  }

  private opsFor(routing: AgentTeamLlmRouting): SettingsFormPathOp[] {
    return [
      { op: 'set', path: ['enabled'], value: routing.enabled },
      { op: 'set', path: ['allowedRoutes'], value: [...routing.allowed.values()].map(copyRoute) },
      { op: 'set', path: ['roleRoutes'], value: routing.roles.map(role => ({ ...copyRoute(role.route), name: role.name })) },
      { op: 'set', path: ['defaultProvider'], value: routing.defaultProvider },
      { op: 'set', path: ['defaultModel'], value: routing.defaultModel },
      { op: 'set', path: ['members'], value: routing.members.map(agentTeamLlmTeamMemberOf) },
    ]
  }

  /** Invalidate and reload model candidates after a Host model input changes. */
  refreshCatalog(): void {
    if (this.disposed) return
    this.catalogGeneration += 1
    this.catalogStatus = 'idle'
    this.catalogPartial = false
    void this.loadCatalog()
  }

  /** Drop Host-specific candidates and drafts, then reload after reconnecting. */
  resetConnection(): void {
    if (this.disposed) return
    this.saveGeneration += 1
    this.saving = false
    this.drafts.clear()
    this.catalogGroups = []
    // The options came from the Host connection that is gone.
    this.memberPermissionsGeneration += 1
    this.memberPermissions = null
    // A read still crossing the wire answers for the previous connection.
    this.workspaceGeneration += 1
    this.readingWorkspace = false
    // The offered sessions belong to the connection that is gone.
    this.candidatesGeneration += 1
    this.workspaceCandidates = []
    this.workspaceCandidatesStatus = 'idle'
    this.selectedSession = undefined
    this.resolvedSession = undefined
    this.refreshCatalog()
    this.refreshMemberPermissions()
    void this.loadWorkspace()
  }

  private async loadCatalog(): Promise<void> {
    if (this.disposed || this.catalogStatus === 'loading') return
    const generation = this.catalogGeneration
    this.catalogStatus = 'loading'
    this.catalogPartial = false
    this.publish()
    const response = await this.ctx.remote.session.modelCatalog()
    if (generation !== this.catalogGeneration) return
    if (response.ok) {
      this.catalogGroups = response.value.groups
      this.catalogPartial = response.value.failures.length > 0
      this.catalogStatus = 'ready'
    } else {
      this.catalogStatus = 'error'
    }
    this.publish()
  }

  /**
   * Read the permissions options a member row selects from.
   *
   * The Host resolves them from the composed permission presets, so this is one
   * request per catalog change rather than a subscription. A refusal leaves the
   * options unknown: rows declaring knobs keep showing their machine pair rather
   * than claiming a preset the Host never confirmed.
   */
  private async loadMemberPermissions(): Promise<void> {
    const generation = (this.memberPermissionsGeneration += 1)
    const result = await this.documents.listMemberPermissionPresets(this.lifetime.signal)
    if (generation !== this.memberPermissionsGeneration || this.disposed) return
    if (result.ok) this.memberPermissions = result.value
    this.publish()
  }

  /** Re-read the permissions options after the Host catalog or connection changed. */
  refreshMemberPermissions(): void {
    if (this.disposed) return
    void this.loadMemberPermissions()
  }

  /**
   * The Session the workspace layer resolves, in order: the one the live session
   * table holds for the main view, then the one the operator picked from the
   * offered candidates, then the newest candidate. A live main-view Session is
   * what the operator is looking at, so an offered candidate never displaces it.
   * @returns the Session identity, or undefined while none resolves.
   */
  private currentSession(): SessionId | undefined {
    const live = this.workspaceSession()
    if (live !== undefined) return live
    if (this.selectedSession !== undefined) return this.selectedSession
    return this.workspaceCandidates[0]?.sessionId
  }

  /**
   * Ask the Host which Sessions it can resolve a project root from. The card
   * asks only when the live session table holds nothing, so the settings page
   * still offers workspaces while a real Session outranks every candidate.
   */
  private async loadWorkspaceCandidates(): Promise<void> {
    if (this.disposed || this.workspaceCandidatesStatus === 'loading') return
    const generation = (this.candidatesGeneration += 1)
    this.workspaceCandidatesStatus = 'loading'
    this.publish()
    const result = await this.documents.listWorkspaceCandidates(this.lifetime.signal)
    if (generation !== this.candidatesGeneration || this.disposed) return
    if (result.ok) {
      this.workspaceCandidates = result.value
      this.workspaceCandidatesStatus = 'ready'
      // A selection the Host no longer offers would resolve a stale document.
      if (this.selectedSession !== undefined
        && !result.value.some(entry => entry.sessionId === this.selectedSession)) {
        this.selectedSession = undefined
      }
      this.publish()
      return
    }
    // A refused list is an error in its own right; reporting it as "no session"
    // would blame the wrong boundary.
    this.workspaceCandidates = []
    this.workspaceCandidatesStatus = 'error'
    this.workspaceStatus = 'error'
    this.workspaceError = result.error.message
    this.workspaceReason = undefined
    this.publish()
  }

  private async loadWorkspace(): Promise<void> {
    if (this.disposed || this.readingWorkspace) return
    let sessionId = this.currentSession()
    // Only a ready list settles the session; an idle or refused list is asked
    // first, because a refusal stays published until a retry reaches the Host.
    if (sessionId === undefined && this.workspaceCandidatesStatus !== 'ready') {
      await this.loadWorkspaceCandidates()
      if (this.disposed) return
      sessionId = this.currentSession()
    }
    if (sessionId === undefined) {
      // The candidate list already published its own refusal; keep it.
      if (this.workspaceCandidatesStatus === 'error') return
      this.workspaceStatus = 'unavailable'
      this.workspacePath = undefined
      this.workspaceError = undefined
      this.workspaceReason = 'noSession'
      this.resolvedSession = undefined
      this.publish()
      return
    }
    this.resolvedSession = sessionId
    const generation = (this.workspaceGeneration += 1)
    this.readingWorkspace = true
    this.workspaceStatus = 'loading'
    this.workspaceError = undefined
    this.workspaceReason = undefined
    this.publish()
    const result = await this.documents.readTeamDocument(sessionId, this.lifetime.signal)
    if (generation !== this.workspaceGeneration) return
    this.readingWorkspace = false
    if (!result.ok) {
      this.workspaceStatus = 'error'
      this.workspaceError = result.error.message
      this.workspaceReason = undefined
      this.publish()
      return
    }
    if (result.value.path === null) {
      // No project root backs this Session, so there is no workspace layer to edit.
      this.workspaceStatus = 'unavailable'
      this.workspaceDocument = undefined
      this.workspacePath = undefined
      this.workspaceReason = 'noProjectRoot'
      this.publish()
      return
    }
    this.workspaceDocument = result.value.document ?? { version: 1 }
    this.workspacePath = result.value.path
    this.workspaceStatus = 'ready'
    this.workspaceReason = undefined
    this.publish()
  }

  /**
   * Resolve the workspace layer from one offered Session. The staged workspace
   * draft belongs to the document the operator was just looking at, so it is
   * dropped rather than carried into another project's file.
   * @param sessionId - Session the operator chose.
   */
  private setWorkspaceSession(sessionId: SessionId): void {
    if (this.disposed || this.saving || this.readingWorkspace) return
    this.selectedSession = sessionId
    this.drafts.delete('workspace')
    void this.loadWorkspace()
  }

  private members(): AgentTeamLlmMemberState[] {
    const routing = this.desiredRouting(this.activeScope)
    const members = routing.members
    return members.map(member => ({
      ...member,
      route: copyRoute(member.route),
      // A member without a route selects the inherit option, so its key stays the empty string.
      key: member.route.provider === '' && member.route.model === ''
        ? ''
        : agentTeamLlmRouteKey(member.route),
      permission: agentTeamLlmMemberPermission(member, this.memberPermissions),
      problems: agentTeamLlmMemberProblem(member, members),
    }))
  }

  private projection(): AgentTeamLlmCardState {
    const snapshot = this.scope.getSnapshot()
    const routing = this.desiredRouting(this.activeScope)
    const candidates = this.candidates()
    const problems = problemsOf(routing)
    const memberProblems = this.memberProblems()
    const members = this.members()
    const memberInvalid = memberProblems.some(row => row.length > 0)
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.dirty(routing),
      invalid: problems.length > 0 || memberInvalid || this.conflicted,
      saving: this.saving,
      failed: this.failed,
      scope: this.activeScope,
      workspace: {
        status: this.workspaceStatus,
        path: this.workspacePath,
        error: this.workspaceError,
        reason: this.workspaceReason,
        candidatesStatus: this.workspaceCandidatesStatus,
        candidates: this.workspaceCandidates,
        sessionId: this.resolvedSession,
      },
      enabled: routing.enabled,
      candidates,
      allowed: candidates.filter(candidate => candidate.selected),
      defaultRoute: { provider: routing.defaultProvider, model: routing.defaultModel },
      roles: routing.roles.map(role => ({ ...role, route: copyRoute(role.route) })),
      members,
      catalogStatus: this.catalogStatus,
      catalogPartial: this.catalogPartial,
      memberPermissions: this.memberPermissions,
      conflicted: this.conflicted,
      problems,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}

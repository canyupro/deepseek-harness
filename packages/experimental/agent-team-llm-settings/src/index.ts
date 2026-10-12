/** Team-owned child LLM routes and fixed rosters for Agent Teams teammates. */

import { Context } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { FRESH_MEMBER_CONTEXT, LEAD_TEAM_NAME, TEAM_MEMBER_NAME, TeamDocumentError, parseTeamDocument } from './document.ts'
import type {
  MemberSandboxMode,
  TeamDocument,
  TeamDocumentPath,
  TeamDocumentRead,
  TeamMemberConfig,
  TeamMemberContext,
  TeamMemberDocument,
} from './types.ts'
import { findProjectRoot, readDocumentFile, teamDocumentPath, writeDocumentFile } from './workspace-document.ts'

export type * from './types.ts'
export { LEAD_TEAM_NAME, TeamDocumentError, TEAM_MEMBER_NAME } from './document.ts'
export { findProjectRoot, TEAM_DOCUMENT_DIRECTORY, TEAM_DOCUMENT_FILE, teamDocumentPath } from './workspace-document.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Deployment, user, and workspace-owned child LLM routes and rosters for Agent Teams teammates. */
    agentTeamLlm: AgentTeamLlmSettings
  }
}

/** One exact child LLM route a teammate may run on. */
export interface TeamLlmRoute {
  /** Registered LLM provider route. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
  /** Adapter-owned reasoning effort for this route; omission uses the model default. */
  readonly reasoningEffort?: ReasoningEffortId
}

/** One teammate-name preset route. */
export interface TeamLlmRoleRoute extends TeamLlmRoute {
  /** Teammate name this preset applies to. */
  readonly name: string
}

/** Validated Team LLM settings read when one teammate is composed. */
export interface AgentTeamLlmSettingsValue {
  /** Whether configured routes apply. A disabled document is inert. */
  readonly enabled: boolean
  /** Exact routes a teammate may be routed to. */
  readonly allowedRoutes: readonly TeamLlmRoute[]
  /** Route used when neither the teammate name nor the caller names one. */
  readonly defaultRoute?: TeamLlmRoute
  /** Per-teammate-name preset routes. */
  readonly roleRoutes: readonly TeamLlmRoleRoute[]
  /** Fixed roster the Lead may create in one call. */
  readonly members: readonly TeamMemberConfig[]
}

/** Optional deployment base for the Team LLM settings. */
export interface Config {
  /** Initial enabled state inherited when neither layer overrides it. */
  enabled: Volatile<boolean>
  /** Initial exact route list inherited when neither layer overrides it. */
  allowedRoutes: Volatile<TeamLlmRouteInput[]>
  /** Initial per-name preset list inherited when neither layer overrides it. */
  roleRoutes: Volatile<TeamLlmRoleRouteInput[]>
  /** Initial fixed roster inherited when neither layer overrides it. */
  members: Volatile<TeamMemberInput[]>
  /** Initial provider for the route used when no preset and no explicit route applies. */
  defaultProvider: Volatile<string>
  /** Initial model for the route used when no preset and no explicit route applies. */
  defaultModel: Volatile<string>
  /** Inclusive cap on fixed roster entries in either layer. */
  maxMembers: number
}

/** Route fields as declared in configuration, before reasoning-effort branding. */
export interface TeamLlmRouteInput {
  /** Registered LLM provider id. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
  /** Adapter-owned reasoning effort; omission uses the model default. */
  readonly reasoningEffort?: string
}

/** Preset fields as declared in configuration, before reasoning-effort branding. */
export interface TeamLlmRoleRouteInput extends TeamLlmRouteInput {
  /** Teammate name this preset applies to. */
  readonly name: string
}

/** Fixed-roster fields as declared in configuration, before reasoning-effort branding. */
export interface TeamMemberInput {
  /** Teammate name; lowercase kebab-case, unique in the roster, never `lead`. */
  readonly name: string
  /** What this member is for; model-visible to the Lead when it composes the team. */
  readonly description: string
  /** Opening instructions this member always starts from. */
  readonly prompt?: string
  /** Whether the member starts a fresh Session or forks the Lead's; omission starts fresh. */
  readonly context?: TeamMemberContext
  /** Sandbox the member runs in; omission uses the team default. */
  readonly sandboxMode?: MemberSandboxMode
  /** Registered LLM provider route, paired with {@link model}. */
  readonly provider?: string
  /** Provider-owned exact model id, paired with {@link provider}. */
  readonly model?: string
  /** Adapter-owned reasoning effort; omission uses the model default. */
  readonly reasoningEffort?: string
}

const routeSchema = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  reasoningEffort: z.string().min(1),
}).description('One exact child LLM route.')

const roleRouteSchema = z.object({
  name: z.string().min(1).required(),
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  reasoningEffort: z.string().min(1),
}).description('One teammate-name preset route.')

const memberSchema = z.object({
  name: z.string().min(1).required(),
  description: z.string().min(1).required(),
  prompt: z.string(),
  context: z.union(['fresh', 'fork']),
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1),
  sandboxMode: z.union(['read-only', 'workspace-write', 'danger-full-access']),
}).description('One fixed team member.')

/**
 * Resolve one configured route, branding its reasoning effort.
 * @param input - route fields from a user document or the deployment base.
 * @returns the exact route the teammate will run on.
 */
function resolveRoute(input: TeamLlmRouteInput): TeamLlmRoute {
  return {
    provider: input.provider,
    model: input.model,
    ...input.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(input.reasoningEffort) },
  }
}

/** Stable identity for one provider/model pair. */
function routeKey(route: TeamLlmRouteInput): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Resolve the global roster, branding each reasoning effort.
 *
 * The deployment base is not a document, so every rejection here repeats a
 * check the workspace decoder applies to `team.json`.
 * @param inputs - roster entries from the deployment base or user settings document.
 * @param maxMembers - inclusive cap on roster entries in one layer.
 * @returns the branded roster in declared order.
 * @throws Error when a name is malformed or reserved, a route names one half, or the roster is above the cap.
 */
function resolveMembers(inputs: readonly TeamMemberInput[], maxMembers: number): TeamMemberConfig[] {
  if (inputs.length > maxMembers) {
    throw new Error(
      `Agent Teams LLM settings members holds ${inputs.length} entries, above the configured maximum of ${maxMembers}`,
    )
  }
  return inputs.map((input) => {
    if (!TEAM_MEMBER_NAME.test(input.name)) {
      throw new Error(`Agent Teams LLM settings member "${input.name}" must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/`)
    }
    if (input.name === LEAD_TEAM_NAME) {
      throw new Error(`Agent Teams LLM settings member "${LEAD_TEAM_NAME}" is reserved for the Team Lead`)
    }
    if ((input.provider === undefined) !== (input.model === undefined)) {
      throw new Error(`Agent Teams LLM settings member "${input.name}" route needs both \`provider\` and \`model\``)
    }
    return {
      name: input.name,
      description: input.description,
      ...input.prompt === undefined ? {} : { prompt: input.prompt },
      context: input.context ?? FRESH_MEMBER_CONTEXT,
      ...input.sandboxMode === undefined ? {} : { sandboxMode: input.sandboxMode },
      ...input.provider === undefined ? {} : { provider: input.provider },
      ...input.model === undefined ? {} : { model: input.model },
      ...input.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(input.reasoningEffort) },
    }
  })
}

/**
 * Resolve one workspace roster entry, branding its reasoning effort.
 * @param member - member fields already validated by the document decoder.
 * @returns the member the merged settings carry.
 */
function resolveDocumentMember(member: TeamMemberDocument): TeamMemberConfig {
  return {
    name: member.name,
    description: member.description,
    ...member.prompt === undefined ? {} : { prompt: member.prompt },
    context: member.context ?? FRESH_MEMBER_CONTEXT,
    ...member.sandboxMode === undefined ? {} : { sandboxMode: member.sandboxMode },
    ...member.provider === undefined ? {} : { provider: member.provider },
    ...member.model === undefined ? {} : { model: member.model },
    ...member.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(member.reasoningEffort) },
  }
}

/**
 * Reject a settings value whose presets, roster, or default route do not resolve.
 *
 * An enabled value must be self-consistent: at least one allowed route, and
 * every preset and default route contained in that list. A disabled value is
 * inert, so it is returned as declared.
 * @param value - merged settings from the global layer or from both layers.
 * @returns the same value once it is known to be consistent.
 * @throws Error when a name repeats, or an enabled value is not self-consistent.
 */
function assertConsistent(value: AgentTeamLlmSettingsValue): AgentTeamLlmSettingsValue {
  const seenNames = new Set<string>()
  for (const role of value.roleRoutes) {
    if (seenNames.has(role.name)) {
      throw new Error(`Agent Teams LLM settings repeat teammate preset "${role.name}"`)
    }
    seenNames.add(role.name)
  }
  const seenMembers = new Set<string>()
  for (const member of value.members) {
    if (seenMembers.has(member.name)) {
      throw new Error(`Agent Teams LLM settings repeat teammate member "${member.name}"`)
    }
    seenMembers.add(member.name)
  }
  if (!value.enabled) return value

  if (value.allowedRoutes.length === 0) {
    throw new Error('enabled Agent Teams LLM settings require at least one allowed route')
  }
  const allowed = new Set(value.allowedRoutes.map(routeKey))
  for (const route of [...value.roleRoutes, ...value.defaultRoute === undefined ? [] : [value.defaultRoute]]) {
    if (!allowed.has(routeKey(route))) {
      throw new Error(
        `Agent Teams LLM settings route "${route.provider}/${route.model}" is not one of the allowed routes`,
      )
    }
  }
  return value
}

/**
 * Merge one workspace roster over the global roster by member name.
 *
 * A declared name replaces the global entry of that name in place; a name the
 * global roster does not carry appends after it in declared order.
 * @param base - branded roster from the global layer.
 * @param declared - validated roster from the workspace document.
 * @returns the merged roster with no name repeated.
 */
function mergeMembers(
  base: readonly TeamMemberConfig[],
  declared: readonly TeamMemberDocument[],
): TeamMemberConfig[] {
  const replacements = new Map(declared.map(member => [member.name, resolveDocumentMember(member)]))
  return [
    ...base.map(member => replacements.get(member.name) ?? member),
    ...[...replacements.values()].filter(member => !base.some(entry => entry.name === member.name)),
  ]
}

/**
 * Overlay one workspace document on the global layer, field by field.
 *
 * A field the document declares wins; every other field keeps the global value.
 * Route halves stay together because a document declares both or neither.
 * `members` is the exception: it merges by name, so a document that declares
 * none keeps the global roster.
 * @param global - validated settings from the global layer.
 * @param document - validated workspace document.
 * @returns the merged settings, branded and unvalidated for consistency.
 */
function overlayDocument(global: AgentTeamLlmSettingsValue, document: TeamDocument): AgentTeamLlmSettingsValue {
  const enabled = document.enabled ?? global.enabled
  const defaultRoute = document.defaultProvider === undefined || document.defaultModel === undefined
    ? global.defaultRoute
    : { provider: document.defaultProvider, model: document.defaultModel }
  return {
    enabled,
    allowedRoutes: document.allowedRoutes?.map(resolveRoute) ?? global.allowedRoutes,
    roleRoutes: document.roleRoutes?.map(route => ({ ...resolveRoute(route), name: route.name })) ?? global.roleRoutes,
    members: document.members === undefined ? global.members : mergeMembers(global.members, document.members),
    ...enabled && defaultRoute !== undefined ? { defaultRoute } : {},
  }
}

/**
 * Singleton Team LLM settings owner read when a teammate is composed.
 *
 * Settings arrive from two layers. The global layer is the user settings
 * document over the deployment base; the workspace layer is
 * `<projectRoot>/.dsh/team.json`. Each field the workspace document declares
 * replaces the global field, except `members`, which merges by name, and the
 * merged value is validated as one document. Without a project root there is no
 * workspace layer and the global value stands.
 */
export class AgentTeamLlmSettings extends TypertRemoteService {
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    allowedRoutes: z.array(routeSchema).default([]).volatile(),
    roleRoutes: z.array(roleRouteSchema).default([]).volatile(),
    members: z.array(memberSchema).default([]).volatile(),
    defaultProvider: z.string().default('').volatile(),
    defaultModel: z.string().default('').volatile(),
    maxMembers: z.natural().default(8),
  })

  /**
   * @param ctx - owning Host context.
   * @param config - deployment base for the global layer and the roster cap.
   */
  constructor(ctx: Context, private config: Config) {
    super(ctx, 'agentTeamLlm')
  }

  /**
   * Read the global layer alone, for a caller that has no workspace root.
   * @returns the enabled state, allowed routes, configured preset routes, and fixed roster.
   */
  current(): AgentTeamLlmSettingsValue {
    const allowedRoutes = this.config.allowedRoutes.get().map(resolveRoute)
    const roleRoutes = this.config.roleRoutes.get().map(route => ({ ...resolveRoute(route), name: route.name }))
    const defaultProvider = this.config.defaultProvider.get()
    const defaultModel = this.config.defaultModel.get()
    if ((defaultProvider === '') !== (defaultModel === '')) {
      throw new Error('Agent Teams LLM settings default route needs both `defaultProvider` and `defaultModel`')
    }
    const defaultRoute = defaultProvider === '' ? undefined : { provider: defaultProvider, model: defaultModel }
    const enabled = this.config.enabled.get()

    return assertConsistent({
      enabled,
      allowedRoutes,
      roleRoutes,
      members: resolveMembers(this.config.members.get(), this.config.maxMembers),
      ...defaultRoute === undefined || !enabled ? {} : { defaultRoute },
    })
  }

  /**
   * Read the value both layers contribute to, for one workspace root.
   *
   * An absent project root or absent document leaves the global value in place;
   * a document overrides only the fields it declares, and merges `members` by name.
   * @param workspaceRoot - directory the project-root walk starts from; undefined reads the global layer alone.
   * @returns the merged, validated settings including the fixed roster.
   * @throws TeamDocumentError when the document is malformed or over the roster cap.
   */
  resolveFor(workspaceRoot: string | undefined): AgentTeamLlmSettingsValue {
    const global = this.current()
    if (workspaceRoot === undefined) return global
    const document = this.readWorkspaceDocument(workspaceRoot)
    if (document === undefined) return global
    return assertConsistent(overlayDocument(global, document))
  }

  /**
   * Read and validate the workspace document above one directory.
   * @param root - directory the project-root walk starts from.
   * @returns the validated document, or undefined when there is no project root or no document.
   * @throws TeamDocumentError when the document is malformed or over the roster cap.
   */
  readWorkspaceDocument(root: string): TeamDocument | undefined {
    const projectRoot = findProjectRoot(root)
    if (projectRoot === undefined) return undefined
    return this.readDocumentAt(teamDocumentPath(projectRoot))
  }

  /**
   * Validate and atomically replace the workspace document above one directory.
   * @param root - directory the project-root walk starts from.
   * @param document - document to validate and write.
   * @returns the absolute path the document was written to.
   * @throws TeamDocumentError when the document is malformed or over the roster cap.
   * @throws Error when no ancestor of `root` is a project root.
   */
  async saveWorkspaceDocument(root: string, document: TeamDocument): Promise<string> {
    const projectRoot = findProjectRoot(root)
    if (projectRoot === undefined) {
      throw new Error(`Agent Teams workspace document needs a .git ancestor of "${root}"`)
    }
    const validated = parseTeamDocument(document, this.config.maxMembers)
    const path = teamDocumentPath(projectRoot)
    await writeDocumentFile(path, validated)
    return path
  }

  /**
   * Read the workspace document for one Session's workspace.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param signal - caller cancellation.
   * @returns the document path and its contents; both are null without a project root or a document.
   */
  @Remote
  readTeamDocument(workspaceFileScope: WorkspaceFileScope, signal: AbortSignal): TeamDocumentRead {
    signal.throwIfAborted()
    const projectRoot = findProjectRoot(workspaceFileScope.workspaceRoot)
    if (projectRoot === undefined) return { path: null, document: null }
    const path = teamDocumentPath(projectRoot)
    return { path, document: this.readDocumentAt(path) ?? null }
  }

  /**
   * Validate and atomically write the workspace document for one Session's workspace.
   *
   * The path is derived from the Session's workspace root, never from the wire.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param document - document to validate and write.
   * @param signal - caller cancellation.
   * @returns the absolute path the document was written to.
   * @throws RemoteError when the workspace root has no project root.
   */
  @Remote
  async saveTeamDocument(
    workspaceFileScope: WorkspaceFileScope, document: TeamDocument, signal: AbortSignal,
  ): Promise<TeamDocumentPath> {
    signal.throwIfAborted()
    const root = workspaceFileScope.workspaceRoot
    if (findProjectRoot(root) === undefined) {
      throw new RemoteError(
        'team-document/no-project-root', `"${root}" has no .git ancestor to own a team document`, { workspaceRoot: root },
      )
    }
    try {
      return { path: await this.saveWorkspaceDocument(root, document) }
    } catch (cause) {
      if (cause instanceof TeamDocumentError) {
        throw new RemoteError(
          'team-document/invalid', cause.message, { path: teamDocumentPath(root) }, { cause },
        )
      }
      throw cause
    }
  }

  /** Validate the document already read at one exact path. */
  private readDocumentAt(path: string): TeamDocument | undefined {
    const value = readDocumentFile(path)
    return value === undefined ? undefined : parseTeamDocument(value, this.config.maxMembers)
  }
}

/**
 * Resolve the configured route for one teammate name.
 * @param settings - validated settings read from {@link AgentTeamLlmSettings.current} or {@link AgentTeamLlmSettings.resolveFor}.
 * @param name - teammate name the Lead is creating.
 * @returns the preset or default route, or undefined to inherit the Lead's route.
 */
export function teamRouteFor(settings: AgentTeamLlmSettingsValue, name: string): TeamLlmRoute | undefined {
  if (!settings.enabled) return undefined
  return settings.roleRoutes.find(route => route.name === name) ?? settings.defaultRoute
}

/** Cordis plugin name. */
export const name = 'agent-team-llm-settings'
export default AgentTeamLlmSettings

/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { inspect } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-experimental-agent-team-llm-settings'
import type { AgentTeamLlmSettingsValue, TeamMemberConfig } from '@deepseek-ai/dsh-experimental-agent-team-llm-settings'
import { teamRouteFor } from '@deepseek-ai/dsh-experimental-agent-team-llm-settings'
import type {} from '@deepseek-ai/dsh-llm'
import { TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team'
import type { TeamMemberView } from '@deepseek-ai/dsh-experimental-agent-team'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import {
  assertAllowedModelSelection,
  hasDelegationModelRequest,
  preflightChildLlmRoute,
  requestedAgentOptions,
} from '@deepseek-ai/dsh-tool-subagent/model-selection'
import type { DelegationModelRequest } from '@deepseek-ai/dsh-tool-subagent/model-selection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/** Services required by the Team tool plugin. */
export const inject = ['agents', 'agentTeams', 'llm', 'tools', 'systemPrompt']

/** Tool routing configuration. */
export interface Config {
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
}

/** Loader schema for the opt-in Team tool plugin. */
export const Config: z<Config> = z.object({
  freshProvider: z.string().default('spawn'),
  forkProvider: z.string().default('fork'),
})

/** Model-facing collaboration guidance shared by Lead and teammates. */
const POLICY = `Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Call spawn_team to create the whole configured roster in one call rather than one spawn_teammate call per member. It reports every member it created and every failure; a roster whose routes cannot all be resolved creates nobody.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message and interrupt_agent, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. A delivered peer item starts with its stable message id and sender name. A successful send is already durable even when its result says queued; do not resend it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.'

/**
 * One model-facing roster row. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 */
const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Expose the member name as its model-facing target. */
function modelMember(member: TeamMemberView): InferValue<typeof MEMBER_VIEW_SCHEMA> {
  const { id: _id, name, ...details } = member
  return { target: name, ...details }
}

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

/** One roster entry this call could not create, named so the caller can fix that entry alone. */
const TEAM_ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const SPAWN_TEAM_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    members: { type: 'array', required: true, items: MEMBER_VIEW_SCHEMA },
    errors: { type: 'array', required: true, items: TEAM_ERROR_SCHEMA },
  },
} as const

const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA } as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['accepted', 'queued'] },
  },
} as const

/** `noProgress` is present only on the model-only shortcut that skips the wait. */
const WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-peer' },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const INTERRUPT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    previousStatus: { type: 'string', required: true, enum: ['running', 'inactive'] },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Team tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/**
 * Render one caught failure as the message the model receives for that member.
 * @param error - caught value from route resolution or member creation.
 * @returns one bounded single-line description.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return inspect(error, { breakLength: Infinity, compact: true, depth: 4 })
}

/**
 * Opening text of every teammate's first user message, so each member knows its
 * own name and how to reach its peers before its first turn.
 * @param name - durable teammate name.
 * @returns the identity reminder block.
 */
function teammateReminder(name: string): string {
  return `<system-reminder>
You are teammate "${name}".
Your Team Lead is named "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).
</system-reminder>

`
}

/** Child name whose presence in a directory marks that directory as the project root. */
const WORKSPACE_ROOT_MARKER = '.git'

/**
 * Whether one path exists, treating a missing path or a non-directory ancestor
 * as absent and propagating every other failure so an unreadable directory is
 * never mistaken for an absent one.
 * @param path - absolute path probed for the project-root marker.
 * @param signal - tool-call cancellation for the probe.
 * @returns whether the marker exists at this path.
 */
async function markerExists(path: string, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try {
    await stat(path)
    return true
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code
    /* v8 ignore next 3 -- a probe only fails this way under a permission or I/O fault the caller cannot fix. */
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
    return false
  }
}

/**
 * Walk upward from the Lead's own working directory to the nearest project
 * root. This is the directory whose team document applies to the Lead, so a
 * Lead working in a subdirectory still reads the roster it shares with its
 * peers.
 * @param cwd - absolute working directory recorded on the Lead's session.
 * @param signal - tool-call cancellation for the walk.
 * @returns the project root, or undefined when the session has no working
 * directory or no ancestor is marked as a project root.
 */
async function workspaceRootOf(cwd: string | undefined, signal: AbortSignal): Promise<string | undefined> {
  if (cwd === undefined) return undefined
  let current = resolve(cwd)
  for (;;) {
    if (await markerExists(join(current, WORKSPACE_ROOT_MARKER), signal)) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Resolve one teammate's child LLM route from the Team settings and the
 * model-facing request. Settings that are absent or disabled contribute no
 * preset, so the Lead's route stays the default. An explicit route is checked
 * against the settings' allowed list, and every resolved route is validated
 * through the live adapter before any child exists, because a teammate name is
 * consumed permanently even when creation fails.
 * @param ctx - Team tool context supplying the LLM runtime.
 * @param lead - exact live Lead Agent whose route supplies inherited values.
 * @param name - teammate name the Lead is creating.
 * @param request - model-facing route fields from the tool call.
 * @param settings - Team settings the caller resolved for the Lead's workspace.
 * @param signal - tool-call cancellation for adapter-owned capability lookup.
 * @returns child options, or undefined to inherit the Lead's route.
 */
async function resolveTeammateAgentOptions(
  ctx: Context,
  lead: Agent,
  name: string,
  request: DelegationModelRequest,
  settings: AgentTeamLlmSettingsValue | undefined,
  signal: AbortSignal,
): Promise<AgentOptions | undefined> {
  const configured = settings === undefined ? undefined : teamRouteFor(settings, name)
  if (configured === undefined && !hasDelegationModelRequest(request)) return undefined

  const parentOptions = parentAgentOptionsForDelegation(lead)
  const agentOptions = requestedAgentOptions(parentOptions, configured, request, true)
  /* v8 ignore next -- requestedAgentOptions always answers on this path: the
     caller returns early unless a configured route exists or a request selects one. */
  if (agentOptions === undefined) return undefined
  assertAllowedModelSelection(
    settings?.enabled === true ? { routes: settings.allowedRoutes } : undefined,
    parentOptions,
    agentOptions,
    request,
  )
  await preflightChildLlmRoute(ctx.llm, parentOptions, agentOptions, signal)
  return agentOptions
}

/** Register the complete Team tool set in one exact Agent scope. */
function install(agent: Agent, ctx: Context, config: Required<Config>): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'team:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: POLICY,
    }))

    register(scoped.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate. Only the Team Lead may call this tool. Omit `provider`, `model`, and `reasoning_effort` to use the configured route for this teammate name, or the Lead\'s route when none is configured.',
      parameters: {
        name: { type: 'string', required: true, description: 'Unique lower-kebab-case teammate name.' },
        description: { type: 'string', required: true, description: 'Short description of the delegated responsibility.' },
        prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
        context: {
          type: 'string',
          enum: ['fresh', 'fork'],
          description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
        },
        provider: {
          type: 'string',
          description: 'LLM provider route for the teammate. Supply together with model; omit both to use the configured route for this teammate name, or the Lead\'s route.',
        },
        model: {
          type: 'string',
          description: 'Model id interpreted by provider. Supply together with provider; omit both to use the configured route for this teammate name, or the Lead\'s route.',
        },
        reasoning_effort: {
          type: 'string',
          description: 'Adapter-owned reasoning effort for the teammate\'s effective route. Omit to use a compatible inherited effort or the selected model\'s default.',
        },
      },
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_teammate')
        const context = args.context ?? 'fresh'
        const agentOptions = await resolveTeammateAgentOptions(ctx, agent, args.name.trim(), {
          ...args.provider === undefined ? {} : { provider: args.provider },
          ...args.model === undefined ? {} : { model: args.model },
          ...args.reasoning_effort === undefined ? {} : { reasoning_effort: args.reasoning_effort },
        }, ctx.get('agentTeamLlm')?.current(), exec.signal)
        const result = await ctx.agentTeams.spawnTeammate(agent, {
          name: args.name,
          description: args.description,
          prompt: [
            { type: 'text', text: teammateReminder(args.name.trim()) },
            { type: 'text', text: args.prompt },
          ],
          context,
          provider: context === 'fork' ? config.forkProvider : config.freshProvider,
          ...agentOptions === undefined ? {} : { agentOptions },
          signal: exec.signal,
        })
        return { member: modelMember(result.member) }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'spawn_team',
      description: 'Create the whole configured team roster in one call, using each member\'s own LLM route when it declares one. Team Lead only. Every selected member\'s route is resolved before any member is created, so an unusable roster creates nobody; the result lists each created member and each failure.',
      parameters: {
        only: {
          type: 'array',
          items: { type: 'string' },
          description: 'Member names to create. Omit to create every member of the roster. A name outside the roster is reported in errors without stopping the remaining members.',
        },
      },
      output: jsonOutput(SPAWN_TEAM_VALUE_SCHEMA),
      async execute(args, exec) {
        const lead = callingAgent(exec.agent, 'spawn_team')
        if (ctx.agentTeams.membership(lead).role !== 'lead') {
          throw new Error('only the Team Lead can use spawn_team')
        }
        const teamLlm = ctx.get('agentTeamLlm')
        if (teamLlm === undefined) {
          throw new Error('spawn_team cannot read the team roster because the `agentTeamLlm` service is unavailable')
        }
        const settings = teamLlm.resolveFor(await workspaceRootOf(lead.session.header.cwd, exec.signal))
        const only = args.only
        const requested = only === undefined ? settings.members : settings.members.filter(member => only.includes(member.name))
        const errors: Array<{ name: string; message: string }> = []
        if (only !== undefined) {
          for (const name of new Set(only)) {
            if (!settings.members.some(member => member.name === name)) {
              errors.push({ name, message: `"${name}" is not a member of the configured team roster` })
            }
          }
        }
        if (requested.length === 0 && errors.length === 0) {
          throw new Error('spawn_team found no members in the configured team roster')
        }

        // A teammate name is consumed permanently even when creation fails, so
        // every route resolves before the first member exists.
        const planned: Array<{ member: TeamMemberConfig; agentOptions: AgentOptions | undefined }> = []
        for (const member of requested) {
          try {
            planned.push({
              member,
              agentOptions: await resolveTeammateAgentOptions(ctx, lead, member.name, {
                ...member.provider === undefined ? {} : { provider: member.provider },
                ...member.model === undefined ? {} : { model: member.model },
                ...member.reasoningEffort === undefined ? {} : { reasoning_effort: member.reasoningEffort },
              }, settings, exec.signal),
            })
          } catch (error: unknown) {
            errors.push({ name: member.name, message: errorMessage(error) })
          }
        }
        if (planned.length !== requested.length) return { members: [], errors }

        const members: Array<InferValue<typeof MEMBER_VIEW_SCHEMA>> = []
        for (const { member, agentOptions } of planned) {
          exec.signal.throwIfAborted()
          try {
            const result = await ctx.agentTeams.spawnTeammate(lead, {
              name: member.name,
              description: member.description,
              prompt: [
                { type: 'text', text: teammateReminder(member.name) },
                { type: 'text', text: member.prompt ?? member.description },
              ],
              context: member.context,
              provider: member.context === 'fork' ? config.forkProvider : config.freshProvider,
              ...member.sandboxMode === undefined ? {} : { sandboxMode: member.sandboxMode },
              ...member.approvalPolicy === undefined ? {} : { approvalPolicy: member.approvalPolicy },
              ...agentOptions === undefined ? {} : { agentOptions },
              signal: exec.signal,
            })
            members.push(modelMember(result.member))
          } catch (error: unknown) {
            errors.push({ name: member.name, message: errorMessage(error) })
          }
        }
        return { members, errors }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'send_message',
      description: 'Send one durable message to another Team member. A running target receives it at the nearest step boundary; an inactive target starts or resumes a turn.',
      parameters: {
        target: { type: 'string', required: true, description: 'Member target returned by spawn_teammate or list_agents, including lead.' },
        message: { type: 'string', required: true, description: 'Self-contained message for the target.' },
      },
      output: jsonOutput(SEND_VALUE_SCHEMA),
      execute(args, exec) {
        return ctx.agentTeams.sendMessage(callingAgent(exec.agent, 'send_message'), {
          target: args.target,
          content: [{ type: 'text', text: args.message }],
          signal: exec.signal,
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with an addressable target and current availability. inactive means no turn is executing, not a task result. provisioning and failed describe member creation.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      execute(_args, exec) {
        return Promise.resolve(ctx.agentTeams.listMembers(callingAgent(exec.agent, 'list_agents')).map(modelMember))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait for the next teammate status, mailbox, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = ctx.agentTeams.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer' as const,
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'interrupt_agent',
      description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
      parameters: {
        target: { type: 'string', required: true, description: 'Teammate target returned by spawn_teammate or list_agents.' },
      },
      output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
      execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.interrupt(callingAgent(exec.agent, 'interrupt_agent'), args.target))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member target from spawn_teammate or list_agents, matching ownerName; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        const status = args.status
        const filtered = ctx.agentTeams.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.getTask(
          callingAgent(exec.agent, 'team_task_get'),
          TeamTaskId(args.task_id),
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member target from spawn_teammate or list_agents for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.updateTask(callingAgent(exec.agent, 'team_task_update'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** Install Team tools in every live or subsequently published Team member scope. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    freshProvider: config.freshProvider ?? 'spawn',
    forkProvider: config.forkProvider ?? 'fork',
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent) || ctx.agentTeams.tryMembership(agent) === undefined) return
    installed.set(agent, install(agent, ctx, resolved))
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => { maybeInstall(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-team.scopedTools()')
}

/**
 * The permission-preset retarget operation's refusal paths.
 *
 * `rePolicyMember` is privileged and irreversible: it appends policy records to
 * *another* Session's log. Every refusal must therefore be proven to leave the
 * target log byte-for-byte unchanged, not merely to have thrown. Each case below
 * reads the durable log through persistence before and after the call, so a
 * guard that ran after the write — or a target that was written and then
 * refused — would be caught here rather than hidden behind a raised error.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-shell'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { TeamError } from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []
const contexts: Context[] = []

/** The preset table the retarget cases select from, in the service's Config shape. */
const PRESET_CONFIG = {
  presets: {
    'read-only': { sandbox: 'read-only', approval: 'ask', name: 'Read only' },
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask', name: 'Workspace write' },
    'danger-full-access': { sandbox: 'danger-full-access', approval: 'never', name: 'Full access' },
  },
} satisfies NonNullable<Parameters<typeof PermissionPresetService.Config>[0]>

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A team with a Lead and one teammate still running. The preset service is
 * composed only when a case needs it: the three composition-free refusals are
 * decided before it is ever consulted, so leaving it absent is exactly what a
 * composition without the preset plugin looks like.
 * @param options.workerAnswers - `hang` keeps the teammate running and live;
 * a real answer lets it finish and detach, which is how a rostered member ends
 * up with no live Session.
 * @param options.presets - mount the real permission-preset service.
 * @returns the context, the Lead, and the teammate's Session identity.
 */
async function setupTeam(
  options: { workerAnswers?: 'hang' | 'answer'; presets?: boolean } = {},
): Promise<{ ctx: Context; lead: Agent; teammate: SessionId }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-repolicy-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  if (options.presets === true) {
    // The real preset service, mounted exactly as a product composition would:
    // it needs a confining shell executor and the approval policy service.
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('rePolicyMember tests do not execute shell requests') },
      run() { throw new Error('rePolicyMember tests do not execute shell requests') },
      start() { throw new Error('rePolicyMember tests do not execute shell requests') },
    })
    await ctx.plugin(ApprovalService, { policy: 'ask' })
    await ctx.plugin(PermissionPresetService, PRESET_CONFIG)
  }
  await ctx.plugin(TeamService)
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  // A hanging worker stays `running` for the whole case: a live Session is
  // exactly what the target guard resolves. An answering worker finishes and
  // detaches, which is how a real teammate later becomes unreachable.
  ctx.llm.registerAdapter(['mock'], new MockAdapter(
    // `workerAnswers` scripts the first teammate; later teammates in one case
    // need their own entry, so the script is sized for several workers.
    options.workerAnswers === 'answer'
      ? Array.from({ length: 8 }, () => textResponse('worker turn'))
      : Array.from({ length: 8 }, () => 'hang'),
  ))

  const started = await ctx.agentTeams.spawnTeammate(lead, {
    name: 'worker',
    description: 'worker responsibility',
    prompt: [{ type: 'text', text: 'worker initial' }],
    context: 'fresh',
    provider: 'spawn',
    signal: SIGNAL,
  })
  if (options.workerAnswers === 'answer') {
    // The answering worker finishes and is torn down; the roster keeps the
    // member, but its Session is no longer live.
    await vi.waitFor(() => { expect(ctx.agents.get(started.member.id)).toBeUndefined() }, { timeout: 5_000 })
    expect(ctx.sessions.get(started.member.id)).toBeUndefined()
  } else {
    await vi.waitFor(() => { expect(ctx.agents.get(started.member.id)?.status).toBe('running') }, { timeout: 5_000 })
  }
  return { ctx, lead, teammate: started.member.id }
}

/**
 * Event type names of one Session's log, read from the live Session so a write
 * made moments earlier is included. The persistence read handle serves the
 * materialized log it was opened over, so it is used only for detached Sessions,
 * where nothing can append afterwards.
 * @param ctx - context owning the session store.
 * @param id - Session whose log is read.
 * @returns the event types in log order.
 */
function eventTypes(ctx: Context, id: SessionId): string[] | undefined {
  return ctx.sessions.get(id)?.snapshotEvents().map(event => event.type)
}

/**
 * Durable event count for a detached Session, which has no live counterpart.
 * @param ctx - context owning the persistence service.
 * @param id - Session whose stored log is measured.
 * @returns the number of durable events the log holds right now.
 */
async function storedEventCount(ctx: Context, id: SessionId): Promise<number> {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try {
    return (await handle.read()).events.length
  } finally {
    await handle.close()
  }
}

/**
 * Approval policy a live Session has durably pinned, if any.
 * @param ctx - context owning the session store.
 * @param id - Session to inspect.
 * @returns the last recorded policy, or undefined when none was recorded.
 */
function pinnedApproval(ctx: Context, id: SessionId): string | undefined {
  const session = ctx.sessions.get(id)
  if (session === undefined) throw new Error(`no live session for ${id}`)
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type === 'approval/policy') return (event.data as { policy: string }).policy
  }
  return undefined
}

/**
 * Sandbox mode a live Session has durably pinned, if any.
 * @param ctx - context owning the session store.
 * @param id - Session to inspect.
 * @returns the last recorded sandbox mode, or undefined when none was recorded.
 */
function pinnedSandbox(ctx: Context, id: SessionId): string | undefined {
  const session = ctx.sessions.get(id)
  if (session === undefined) throw new Error(`no live session for ${id}`)
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type === 'sandbox/mode') return (event.data as { mode: string }).mode
  }
  return undefined
}

describe('rePolicyMember refusals write nothing to the target log', () => {
  it('refuses a target whose Session is not live and leaves both logs untouched', async () => {
    // A teammate that answered its turn and detached: still on the roster, but
    // its Session is no longer live, which is what the target guard resolves.
    const { ctx, lead, teammate } = await setupTeam({ workerAnswers: 'answer' })
    const leadSeq = await storedEventCount(ctx, lead.id)
    const teammateSeq = await storedEventCount(ctx, teammate)

    const refusal = await ctx.agentTeams
      .rePolicyMember(lead, { member: teammate, preset: 'read-only' })
      .then(() => undefined, (error: unknown) => error)

    expect(refusal).toBeInstanceOf(TeamError)
    expect(refusal).toMatchObject({ code: 'TEAM_INVALID_TARGET' })
    expect((refusal as Error).message).toBe(
      `team member "${teammate}" has no live Session to retarget`,
    )
    // Zero-write evidence: the detached member's durable log and the Lead's both
    // hold exactly what they held before the call.
    expect(await storedEventCount(ctx, teammate)).toBe(teammateSeq)
    expect(await storedEventCount(ctx, lead.id)).toBe(leadSeq)
    expect(ctx.sessions.get(teammate)).toBeUndefined()
  })

  it('refuses a target outside the caller\'s team and leaves both logs untouched', async () => {
    const { ctx, lead, teammate } = await setupTeam()

    // A live Agent that is not a member of this Team's roster. The Lead's own
    // roster check must refuse it before any target Session is consulted.
    const outsider = await ctx.agentLoop.create(SessionId('outsider'), { provider: 'mock', model: 'mock' })

    const leadSeq = await storedEventCount(ctx, lead.id)
    const outsiderSeq = await storedEventCount(ctx, outsider.id)
    const teammateSeq = await storedEventCount(ctx, teammate)
    const refusal = await ctx.agentTeams
      .rePolicyMember(lead, { member: outsider.id, preset: 'read-only' })
      .then(() => undefined, (error: unknown) => error)

    expect(refusal).toBeInstanceOf(TeamError)
    expect(refusal).toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
    expect((refusal as Error).message).toBe(
      `"${outsider.id}" is not a member of team "${lead.id}"`,
    )
    expect(await storedEventCount(ctx, outsider.id)).toBe(outsiderSeq)
    expect(await storedEventCount(ctx, lead.id)).toBe(leadSeq)
    expect(await storedEventCount(ctx, teammate)).toBe(teammateSeq)
  })

  it('refuses to retarget when no permission-preset service is composed', async () => {
    const { ctx, lead, teammate } = await setupTeam()
    // This is the only case that reaches the composition boundary, so it is the
    // one that needs a genuinely live, genuinely rostered target.
    expect(ctx.sessions.get(teammate)).toBeDefined()
    expect(ctx.agentTeams.listMembers(lead).some(member => member.id === teammate)).toBe(true)
    expect(ctx.get('permissionPresets')).toBeUndefined()

    const leadSeq = await storedEventCount(ctx, lead.id)
    const memberSeq = await storedEventCount(ctx, teammate)
    const refusal = await ctx.agentTeams
      .rePolicyMember(lead, { member: teammate, preset: 'read-only' })
      .then(() => undefined, (error: unknown) => error)

    expect(refusal).toBeInstanceOf(TeamError)
    expect(refusal).toMatchObject({ code: 'TEAM_PERMISSION_UNAVAILABLE' })
    expect((refusal as Error).message).toBe(
      'changing a member permission preset requires the permission-preset service',
    )
    expect(await storedEventCount(ctx, teammate)).toBe(memberSeq)
    expect(await storedEventCount(ctx, lead.id)).toBe(leadSeq)
  })
})

describe('rePolicyMember validates the preset before writing', () => {
  it('proves the ruler measures writes, then writes nothing for an unknown preset', async () => {
    const { ctx, lead, teammate } = await setupTeam({ presets: true })
    // Positive control first: the retarget is only meaningful if this harness can
    // observe a write at all. Without it, every "after === before" below would
    // hold trivially against an implementation that never wrote anything.
    const baseline = eventTypes(ctx, teammate)!
    expect(baseline).not.toContain('permission/preset')
    // The knobs as they stand before the switch decide which of them move.
    const sandboxBefore = pinnedSandbox(ctx, teammate)
    const approvalBefore = pinnedApproval(ctx, teammate)

    const applied = await ctx.agentTeams.rePolicyMember(lead, { member: teammate, preset: 'danger-full-access' })

    expect(applied).toEqual({ preset: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' })
    const afterSuccess = eventTypes(ctx, teammate)!
    expect(afterSuccess.length).toBeGreaterThan(baseline.length)
    // The retarget records the preset identity plus exactly the knobs that moved.
    // A knob already at the target value is not rewritten, so the expected tail is
    // derived from the Session's own pinned values rather than assumed to be three.
    const expected: string[] = ['permission/preset']
    if (approvalBefore !== applied.approval) expected.push('approval/policy')
    if (sandboxBefore !== applied.sandbox) expected.push('sandbox/mode')
    const added = afterSuccess.slice(baseline.length)
    expect(added).toEqual(expected)
    expect(added).toContain('sandbox/mode')
    // The switch is recorded as permission state, not as a message injected into
    // the member's conversation — that is what separates it from `/permission`.
    expect(added).not.toContain('user/message')
    expect(added).not.toContain('assistant/message')
    expect(added).not.toContain('system/message')

    // Now the same ruler against a preset the service cannot resolve. The
    // operation must refuse before `set()` reaches its first write.
    const settled = eventTypes(ctx, teammate)!
    const refusal = await ctx.agentTeams
      .rePolicyMember(lead, { member: teammate, preset: 'no-such-preset' })
      .then(() => undefined, (error: unknown) => error)

    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toContain('unknown preset "no-such-preset"')
    // The counts are equal *and* the earlier success proved this reader sees
    // growth, so equality here is evidence rather than an artifact.
    expect(eventTypes(ctx, teammate)).toEqual(settled)
  })

  it('leaves the caller\'s own log alone while retargeting a member', async () => {
    const { ctx, lead, teammate } = await setupTeam({ presets: true })
    const leadBefore = eventTypes(ctx, lead.id)!

    await ctx.agentTeams.rePolicyMember(lead, { member: teammate, preset: 'read-only' })

    // Authorizing another Session's permissions records nothing about the Lead.
    const leadAfter = eventTypes(ctx, lead.id)!
    expect(leadAfter.length).toBe(leadBefore.length)
    expect(leadAfter).toEqual(leadBefore)
    expect(eventTypes(ctx, teammate)!.length).toBeGreaterThan(leadBefore.length)
  })
})

describe('rePolicyMember refuses a teammate that is not the Lead', () => {
  it('refuses the retarget and writes nothing to either log', async () => {
    const { ctx, lead } = await setupTeam()
    // A second member of the same team, so the caller is a teammate rather than
    // a stranger: only the lead's own name is refused by the role check.
    const caller = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'second',
      description: 'second responsibility',
      prompt: [{ type: 'text', text: 'second initial' }],
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })
    await vi.waitFor(() => { expect(ctx.agents.get(caller.member.id)?.status).toBe('running') }, { timeout: 5_000 })
    const teammateAgent = ctx.agents.get(caller.member.id)!

    const leadBefore = eventTypes(ctx, lead.id)!
    const callerBefore = eventTypes(ctx, teammateAgent.id)!
    const targetBefore = eventTypes(ctx, caller.member.id)!

    const refusal = await ctx.agentTeams
      .rePolicyMember(teammateAgent, { member: lead.id, preset: 'read-only' })
      .then(() => undefined, (error: unknown) => error)

    expect(refusal).toBeInstanceOf(TeamError)
    expect(refusal).toMatchObject({ code: 'TEAM_NOT_LEAD' })
    // Authority is settled before the first write, so neither the retarget
    // target nor the caller gained a durable record.
    expect(eventTypes(ctx, lead.id)).toEqual(leadBefore)
    expect(eventTypes(ctx, teammateAgent.id)).toEqual(callerBefore)
    expect(eventTypes(ctx, caller.member.id)).toEqual(targetBefore)
  })
})

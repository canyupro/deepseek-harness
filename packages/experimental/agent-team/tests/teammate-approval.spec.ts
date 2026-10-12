/**
 * `approvalPolicy` declared on a teammate request reaching the child Session.
 *
 * The delegation default pins a child to `never` whenever an approval capability
 * is composed, so a request that declares its own policy is the only thing that
 * distinguishes "the caller's choice arrived" from "the default fired". Both
 * halves are asserted here: the declared case proves the value arrives, and the
 * omitted case proves the pin is still `never`, so a broken pass-through that
 * silently substituted the default could not pass.
 *
 * The judgement is read from the child's own durable `approval/policy` event,
 * which carries `source: 'delegation'` — the same record the production
 * replay path reconstructs from, not an in-memory projection.
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
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { type MemberApprovalPolicy } from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A Lead with the approval capability composed, which is what makes the
 * delegation default pin observable in the first place.
 * @returns the context and the Lead agent.
 */
async function setupLead(): Promise<{ ctx: Context; lead: Agent }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-approval-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(TeamService)
  ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: 8 }, () => 'hang')))
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead }
}

/**
 * The child's own `approval/policy` delegation record, read from its live log.
 * @param ctx - context owning the session store.
 * @param id - child Session to inspect.
 * @returns the policy and whether the record carries the delegation marker.
 */
function delegatedApproval(ctx: Context, id: SessionId): { policy: string; source?: string } | undefined {
  const session = ctx.sessions.get(id)
  if (session === undefined) throw new Error(`no live session for ${id}`)
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'approval/policy') continue
    const data = event.data as { policy: string; source?: string }
    // The marker is spread only when present: an optional property under
    // `exactOptionalPropertyTypes` does not accept an explicit `undefined`.
    return { policy: data.policy, ...data.source === undefined ? {} : { source: data.source } }
  }
  return undefined
}

/**
 * Spawn one teammate and wait until it is running.
 * @param ctx - context owning the Team service.
 * @param lead - the Team Lead creating the teammate.
 * @param name - teammate name.
 * @param approvalPolicy - policy to declare, or omitted to keep the default.
 * @returns the child's Session identity.
 */
async function spawnChild(
  ctx: Context,
  lead: Agent,
  name: string,
  approvalPolicy?: MemberApprovalPolicy,
): Promise<SessionId> {
  const started = await ctx.agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} responsibility`,
    prompt: [{ type: 'text', text: `${name} initial` }],
    context: 'fresh',
    provider: 'spawn',
    ...approvalPolicy === undefined ? {} : { approvalPolicy },
    signal: SIGNAL,
  })
  await vi.waitFor(() => {
    expect(ctx.agents.get(started.member.id)?.status).toBe('running')
  }, { timeout: 5_000 })
  return started.member.id
}

describe('teammate approvalPolicy reaches the child Session', () => {
  it('pins the child to the declared policy instead of the delegation default', async () => {
    const { ctx, lead } = await setupLead()

    const child = await spawnChild(ctx, lead, 'declared', 'ask')

    // `ask` is only reachable through the caller's request: the delegation
    // default pins `never` whenever the approval capability is composed.
    expect(delegatedApproval(ctx, child)).toEqual({ policy: 'ask', source: 'delegation' })
  })

  it('keeps the delegation default `never` when no policy is declared', async () => {
    const { ctx, lead } = await setupLead()

    const child = await spawnChild(ctx, lead, 'undeclared')

    // The contrast case: without this, a pass-through that ignored the request
    // and always captured the default would satisfy the case above only when
    // the requested value happened to equal the default.
    expect(delegatedApproval(ctx, child)).toEqual({ policy: 'never', source: 'delegation' })
  })

  it('honours the Lead\'s own policy when the request names one different from it', async () => {
    const { ctx, lead } = await setupLead()

    const child = await spawnChild(ctx, lead, 'second', 'never')
    const other = await spawnChild(ctx, lead, 'third', 'ask')

    // Both directions of the override are exercised in one composition, so a
    // pass-through that always wrote the default, or always wrote the request,
    // would disagree with one of them.
    expect(delegatedApproval(ctx, child)).toEqual({ policy: 'never', source: 'delegation' })
    expect(delegatedApproval(ctx, other)).toEqual({ policy: 'ask', source: 'delegation' })
  })
})

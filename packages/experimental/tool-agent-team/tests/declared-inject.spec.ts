/**
 * The declared-injection contract: the team tools list `llm` among the services
 * they require, so a composition that does not compose one never activates the
 * plugin and never registers its tools.
 *
 * The point of declaring the dependency is that the absence is observable up
 * front, instead of surfacing later as a failed teammate creation.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SubagentService from '@deepseek-ai/dsh-subagent'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import * as toolTeam from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Mount every service the team tools declare except `llm`.
 *
 * `SubagentService` declares no injections of its own and `TeamService` only
 * needs agents/sessions/persistence/projections/subagents, so the team service
 * comes up normally: `llm` is the single missing dependency.
 */
async function setupWithoutLlm() {
  const ctx = new Context()
  contexts.push(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-declared-inject-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentService)
  await ctx.plugin(TeamService)
  return { ctx }
}

function execute(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    callId: ToolCallId(`declared-inject-${name}`),
    name,
    arguments: args,
    signal: AbortSignal.timeout(10_000),
  })
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

describe('declared injection of the LLM service', () => {
  it('declares llm among the services the plugin requires', () => {
    // A required service belongs in `inject`, not behind a `ctx.get` guard that
    // fails only once someone asks for a teammate.
    expect(toolTeam.inject).toEqual(['agents', 'agentTeams', 'llm', 'tools', 'systemPrompt'])
  })

  it('registers no tools while the composition has no LLM service', async () => {
    const { ctx } = await setupWithoutLlm()

    // Not awaited: with `llm` missing the plugin stays pending by design.
    ctx.plugin(toolTeam)

    expect(ctx.get('llm')).toBeUndefined()
    // The team service itself is live, so `llm` is the only absent dependency.
    expect(ctx.get('agentTeams')).toBeDefined()

    for (const name of ['spawn_team', 'spawn_teammate', 'list_agents']) {
      const result = await execute(ctx, name, {})
      expect(result.isError, `${name} should be unknown`).toBe(true)
      expect(text(result)).toContain(`unknown tool "${name}"`)
    }
  })
})

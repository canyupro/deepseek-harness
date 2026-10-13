import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import AgentTeamLlmSettings, { teamRouteFor } from '../src/index.ts'
import type { TeamDocument } from '../src/index.ts'

const ROUTE = { provider: 'mock', model: 'flash' }
const OTHER = { provider: 'mock', model: 'strong' }

/** The failure code one synchronous Remote call threw with. */
function failureCode(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    const failure = remoteErrorOf(error)
    if (failure !== undefined) return failure.code
    throw error
  }
  throw new Error('expected a RemoteError failure')
}

/**
 * A Context the settings service mounts on. The service injects nothing and
 * reads the Workspace registry opportunistically, so a case provides that
 * registry only when it exercises the workspace document Remotes.
 */
async function testContext(): Promise<Context> {
  return new Context()
}

describe('agent-team-llm-settings', () => {
  it('is inert while disabled', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, { allowedRoutes: [ROUTE], roleRoutes: [{ ...OTHER, name: 'recon' }] })
    expect(ctx.agentTeamLlm.current().enabled).toBe(false)
    expect(teamRouteFor(ctx.agentTeamLlm.current(), 'recon')).toBeUndefined()
    await ctx.fiber.dispose()
    expect(ctx.get('agentTeamLlm')).toBeUndefined()
  })

  it('resolves a preset by teammate name, then the default route', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [ROUTE, OTHER],
      defaultProvider: ROUTE.provider,
      defaultModel: ROUTE.model,
      roleRoutes: [{ ...OTHER, name: 'recon' }],
    })
    const current = ctx.agentTeamLlm.current()
    expect(teamRouteFor(current, 'recon')).toMatchObject({ provider: 'mock', model: 'strong' })
    expect(teamRouteFor(current, 'implement')).toMatchObject({ provider: 'mock', model: 'flash' })
  })

  it('falls back to inheriting the Lead route without a preset or default', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, { enabled: true, allowedRoutes: [ROUTE] })
    expect(teamRouteFor(ctx.agentTeamLlm.current(), 'recon')).toBeUndefined()
  })

  it('brands a configured reasoning effort', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [{ ...ROUTE, reasoningEffort: 'high' }],
      defaultProvider: ROUTE.provider,
      defaultModel: ROUTE.model,
      roleRoutes: [{ ...ROUTE, reasoningEffort: 'high', name: 'recon' }],
    })
    const preset = teamRouteFor(ctx.agentTeamLlm.current(), 'recon')
    expect(preset?.reasoningEffort).toBe('high')
  })

  it('rejects a default route that names only one half', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, { enabled: true, allowedRoutes: [ROUTE], defaultProvider: ROUTE.provider })
    expect(() => ctx.agentTeamLlm.current()).toThrow(/needs both `defaultProvider` and `defaultModel`/u)
  })

  it('rejects an enabled document without an allowed route', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, { enabled: true })
    expect(() => ctx.agentTeamLlm.current()).toThrow(/at least one allowed route/u)
  })

  it('rejects a preset route outside the allowed list', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [ROUTE],
      roleRoutes: [{ ...OTHER, name: 'recon' }],
    })
    expect(() => ctx.agentTeamLlm.current()).toThrow(/not one of the allowed routes/u)
  })

  it('rejects a default route outside the allowed list', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [ROUTE],
      defaultProvider: OTHER.provider,
      defaultModel: OTHER.model,
    })
    expect(() => ctx.agentTeamLlm.current()).toThrow(/not one of the allowed routes/u)
  })

  it('rejects a repeated teammate preset name', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [ROUTE],
      roleRoutes: [{ ...ROUTE, name: 'recon' }, { ...ROUTE, name: 'recon' }],
    })
    expect(() => ctx.agentTeamLlm.current()).toThrow(/repeat teammate preset "recon"/u)
  })

  it('ignores an allow-list violation while the document is disabled', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      allowedRoutes: [ROUTE],
      defaultProvider: OTHER.provider,
      defaultModel: OTHER.model,
    })
    expect(ctx.agentTeamLlm.current().enabled).toBe(false)
  })

  it('reports no fixed roster while only the global layer is read', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, { enabled: true, allowedRoutes: [ROUTE] })
    expect(ctx.agentTeamLlm.current().members).toEqual([])
  })

  it('resolves a fixed roster from the global layer', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [ROUTE, OTHER],
      members: [{
        name: 'recon',
        description: 'Maps the tree before anything changes.',
        prompt: 'Read the layout first.',
        context: 'fork',
        provider: ROUTE.provider,
        model: ROUTE.model,
        reasoningEffort: 'high',
      }],
    })

    expect(ctx.agentTeamLlm.current().members).toEqual([{
      name: 'recon',
      description: 'Maps the tree before anything changes.',
      prompt: 'Read the layout first.',
      context: 'fork',
      provider: 'mock',
      model: 'flash',
      reasoningEffort: 'high',
    }])
  })

  it('defaults a global member to a fresh context without a route', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, { members: [{ name: 'recon', description: 'Maps the tree.' }] })

    expect(ctx.agentTeamLlm.current().members).toEqual([
      { name: 'recon', description: 'Maps the tree.', context: 'fresh' },
    ])
  })

  it('rejects a global member name that is not lowercase kebab-case', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, { members: [{ name: 'Recon Bot', description: 'Reads.' }] })

    expect(() => ctx.agentTeamLlm.current()).toThrow(/member "Recon Bot" must match/u)
  })

  it('rejects a global member name reserved for the Lead', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, { members: [{ name: 'lead', description: 'Reads.' }] })

    expect(() => ctx.agentTeamLlm.current()).toThrow(/member "lead" is reserved for the Team Lead/u)
  })

  it('rejects a repeated global member name', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      members: [{ name: 'recon', description: 'Reads.' }, { name: 'recon', description: 'Reads twice.' }],
    })

    expect(() => ctx.agentTeamLlm.current()).toThrow(/repeat teammate member "recon"/u)
  })

  it('rejects a global roster above the deployment cap', async () => {
    const ctx = await testContext()
    await ctx.plugin(AgentTeamLlmSettings, {
      maxMembers: 1,
      members: [{ name: 'recon', description: 'Reads.' }, { name: 'reviewer', description: 'Reviews.' }],
    })

    expect(() => ctx.agentTeamLlm.current())
      .toThrow(/members holds 2 entries, above the configured maximum of 1/u)
  })

  it('rejects a global member route that names only one half', async () => {
    const providerOnly = await testContext()
    await providerOnly.plugin(AgentTeamLlmSettings, {
      members: [{ name: 'recon', description: 'Reads.', provider: ROUTE.provider }],
    })
    expect(() => providerOnly.agentTeamLlm.current())
      .toThrow(/member "recon" route needs both `provider` and `model`/u)

    const modelOnly = await testContext()
    await modelOnly.plugin(AgentTeamLlmSettings, {
      members: [{ name: 'reviewer', description: 'Reviews.', model: ROUTE.model }],
    })
    expect(() => modelOnly.agentTeamLlm.current())
      .toThrow(/member "reviewer" route needs both `provider` and `model`/u)
  })
})

describe('agent-team-llm-settings workspace document', () => {
  let root: string
  let repo: string
  let ctx: Context

  /** Build a project root with a `.git` marker plus a nested working directory. */
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-team-settings-'))
    repo = join(root, 'repo')
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'packages', 'app'), { recursive: true })
    ctx = await testContext()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  /** Write raw JSON as the workspace document, bypassing every write path. */
  async function writeRaw(value: unknown): Promise<void> {
    await mkdir(join(repo, '.dsh'), { recursive: true })
    await writeFile(join(repo, '.dsh', 'team.json'), JSON.stringify(value), 'utf8')
  }

  /** Mount the service with the global layer every merge test starts from. */
  async function mount(): Promise<void> {
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [ROUTE, OTHER],
      defaultProvider: ROUTE.provider,
      defaultModel: ROUTE.model,
      roleRoutes: [{ ...OTHER, name: 'recon' }],
    })
  }

  /** Mount the service with a global roster the workspace merge starts from. */
  async function mountRoster(): Promise<void> {
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [ROUTE, OTHER],
      members: [
        { name: 'recon', description: 'Global recon.', prompt: 'Read the tree.' },
        { name: 'reviewer', description: 'Global reviewer.', provider: ROUTE.provider, model: ROUTE.model },
      ],
    })
  }

  it('merges the workspace document field by field over the global layer', async () => {
    await mount()
    await ctx.agentTeamLlm.saveWorkspaceDocument(repo, {
      version: 1,
      members: [{ name: 'recon', description: 'Reads the tree before anything changes.' }],
    })

    const resolved = ctx.agentTeamLlm.resolveFor(repo)

    expect(resolved.members).toEqual([{ name: 'recon', description: 'Reads the tree before anything changes.', context: 'fresh' }])
    expect(teamRouteFor(resolved, 'recon')).toMatchObject({ provider: 'mock', model: 'strong' })
    expect(resolved.defaultRoute).toEqual(ROUTE)
    expect(resolved.enabled).toBe(true)
  })

  it('lets the workspace document override only the fields it declares', async () => {
    await mount()
    await ctx.agentTeamLlm.saveWorkspaceDocument(repo, {
      version: 1,
      allowedRoutes: [ROUTE, { ...OTHER, provider: 'mock', model: 'local' }],
      defaultProvider: 'mock',
      defaultModel: 'local',
      roleRoutes: [{ name: 'recon', provider: 'mock', model: 'local' }],
      enabled: false,
    })

    const resolved = ctx.agentTeamLlm.resolveFor(repo)

    expect(resolved.enabled).toBe(false)
    expect(resolved.roleRoutes).toEqual([{ name: 'recon', provider: 'mock', model: 'local' }])
    expect(resolved.allowedRoutes).toEqual([ROUTE, { provider: 'mock', model: 'local' }])
    expect(teamRouteFor(resolved, 'recon')).toBeUndefined()
  })

  it('brands a member reasoning effort declared in the workspace document', async () => {
    await mount()
    await writeRaw({
      version: 1,
      members: [{
        name: 'reviewer',
        description: 'Reads the diff.',
        context: 'fork',
        prompt: 'Review carefully.',
        provider: 'mock',
        model: 'strong',
        reasoningEffort: 'high',
      }],
    })

    expect(ctx.agentTeamLlm.resolveFor(repo).members[0]).toEqual({
      name: 'reviewer',
      description: 'Reads the diff.',
      context: 'fork',
      prompt: 'Review carefully.',
      provider: 'mock',
      model: 'strong',
      reasoningEffort: 'high',
    })
  })

  it('brands a route reasoning effort declared in the workspace document', async () => {
    await mount()
    await writeRaw({
      version: 1,
      allowedRoutes: [{ provider: 'mock', model: 'flash', reasoningEffort: 'high' }],
      roleRoutes: [{ name: 'recon', provider: 'mock', model: 'flash', reasoningEffort: 'high' }],
    })

    const resolved = ctx.agentTeamLlm.resolveFor(repo)

    expect(resolved.allowedRoutes).toEqual([{ provider: 'mock', model: 'flash', reasoningEffort: 'high' }])
    expect(resolved.roleRoutes).toEqual([{ name: 'recon', provider: 'mock', model: 'flash', reasoningEffort: 'high' }])
  })

  it('merges the workspace roster by name over the global roster', async () => {
    await mountRoster()
    await writeRaw({
      version: 1,
      members: [
        { name: 'recon', description: 'Workspace recon.' },
        { name: 'builder', description: 'Builds the change.' },
      ],
    })

    expect(ctx.agentTeamLlm.resolveFor(repo).members).toEqual([
      { name: 'recon', description: 'Workspace recon.', context: 'fresh' },
      { name: 'reviewer', description: 'Global reviewer.', context: 'fresh', provider: 'mock', model: 'flash' },
      { name: 'builder', description: 'Builds the change.', context: 'fresh' },
    ])
  })

  it('keeps the global roster when the workspace document declares no members', async () => {
    await mountRoster()
    await ctx.agentTeamLlm.saveWorkspaceDocument(repo, { version: 1, enabled: false })

    expect(ctx.agentTeamLlm.resolveFor(repo).members).toEqual([
      { name: 'recon', description: 'Global recon.', prompt: 'Read the tree.', context: 'fresh' },
      { name: 'reviewer', description: 'Global reviewer.', context: 'fresh', provider: 'mock', model: 'flash' },
    ])
  })

  it('finds the project root from a nested working directory', async () => {
    await mount()
    await ctx.agentTeamLlm.saveWorkspaceDocument(join(repo, 'packages', 'app'), { version: 1 })

    expect(ctx.agentTeamLlm.readWorkspaceDocument(join(repo, 'packages', 'app'))).toEqual({ version: 1 })
    expect(ctx.agentTeamLlm.readWorkspaceDocument(join(root, 'packages', 'app'))).toBeUndefined()
  })

  it('reads a `.git` file as the project-root marker', async () => {
    await mount()
    const worktree = join(root, 'worktree')
    await mkdir(worktree, { recursive: true })
    await writeFile(join(worktree, '.git'), 'gitdir: ../repo/.git/worktrees/worktree', 'utf8')
    await ctx.agentTeamLlm.saveWorkspaceDocument(worktree, { version: 1 })

    expect(ctx.agentTeamLlm.readWorkspaceDocument(worktree)).toEqual({ version: 1 })
  })

  it('falls back to the global layer when no ancestor is a project root', async () => {
    await mount()
    const detached = await mkdtemp(join(tmpdir(), 'dsh-team-detached-'))

    try {
      expect(ctx.agentTeamLlm.resolveFor(detached)).toEqual(ctx.agentTeamLlm.current())
      expect(ctx.agentTeamLlm.resolveFor(undefined)).toEqual(ctx.agentTeamLlm.current())
      await expect(ctx.agentTeamLlm.saveWorkspaceDocument(detached, { version: 1 }))
        .rejects.toThrow(/needs a \.git ancestor/u)
    } finally {
      await rm(detached, { recursive: true, force: true })
    }
  })

  it('falls back to the global layer when the project root carries no document', async () => {
    await mount()

    expect(ctx.agentTeamLlm.resolveFor(repo)).toEqual(ctx.agentTeamLlm.current())
  })

  it('rejects an unknown document field by naming it', async () => {
    await mount()
    await writeRaw({ version: 1, roster: [] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(/unknown field "roster"/u)
  })

  it('rejects a document that is not a JSON object', async () => {
    await mount()
    await writeRaw(null)

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json: expected a JSON object, got null/u)

    await writeRaw([])
    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json: expected a JSON object, got an array/u)
  })

  it('rejects a member whose name or description is not a non-empty string', async () => {
    await mount()
    await writeRaw({ version: 1, members: [{ name: 7, description: 'Reads.' }] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members\[0\]\.name: must be a non-empty string/u)

    await writeRaw({ version: 1, members: [{ name: 'recon', description: 7 }] })
    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members\[0\]\.description: must be a non-empty string/u)
  })

  it('rejects a member prompt that is not a string', async () => {
    await mount()
    await writeRaw({ version: 1, members: [{ name: 'recon', description: 'Reads.', prompt: 7 }] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members\[0\]\.prompt: must be a string, got a number/u)
  })

  it('rejects a member list that is not an array', async () => {
    await mount()
    await writeRaw({ version: 1, members: {} })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members: must be an array, got a object/u)
  })

  it('rejects a member context other than fresh or fork', async () => {
    await mount()
    await writeRaw({ version: 1, members: [{ name: 'recon', description: 'Reads.', context: 'reuse' }] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members\[0\]\.context: must be "fresh" or "fork"/u)
  })

  it('rejects a member route that names "provider" without "model"', async () => {
    await mount()
    await writeRaw({ version: 1, members: [{ name: 'recon', description: 'Reads.', provider: 'mock' }] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members\[0\]: names "provider" without "model"/u)
  })

  it('rejects a default route that names only "defaultModel"', async () => {
    await mount()
    await writeRaw({ version: 1, defaultModel: 'flash' })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json: names "defaultModel" without "defaultProvider"/u)
  })

  it('rejects an unknown member field by naming it', async () => {
    await mount()
    await writeRaw({ version: 1, members: [{ name: 'recon', description: 'Reads.', seniority: 'staff' }] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(/team\.json members\[0\]: unknown field "seniority"/u)
  })

  it('rejects a version other than 1 without downgrading', async () => {
    await mount()
    await writeRaw({ version: 2 })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(/version/u)
  })

  it('rejects a default route that names only one half', async () => {
    await mount()
    await writeRaw({ version: 1, defaultProvider: 'mock' })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(/team\.json: names "defaultProvider" without "defaultModel"/u)
  })

  it('rejects a member route that names only one half', async () => {
    await mount()
    await writeRaw({ version: 1, members: [{ name: 'recon', description: 'Reads.', model: 'strong' }] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(/team\.json members\[0\]: names "model" without "provider"/u)
  })

  it('rejects a member name that is not lowercase kebab-case', async () => {
    await mount()
    await writeRaw({ version: 1, members: [{ name: 'Recon Bot', description: 'Reads.' }] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members\[0\]\.name: "Recon Bot" must match/u)
  })

  it('rejects a member name reserved for the Lead', async () => {
    await mount()
    await writeRaw({ version: 1, members: [{ name: 'lead', description: 'Reads.' }] })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members\[0\]\.name: "lead" is reserved for the Team Lead/u)
  })

  it('rejects a repeated member name', async () => {
    await mount()
    await writeRaw({
      version: 1,
      members: [{ name: 'recon', description: 'Reads.' }, { name: 'recon', description: 'Reads twice.' }],
    })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(/team\.json members\[1\]\.name: "recon" repeats an earlier member/u)
  })

  it('rejects a roster above the deployment cap', async () => {
    await ctx.plugin(AgentTeamLlmSettings, { maxMembers: 1 })
    await writeRaw({
      version: 1,
      members: [{ name: 'recon', description: 'Reads.' }, { name: 'reviewer', description: 'Reviews.' }],
    })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo))
      .toThrow(/team\.json members: holds 2 entries, above the configured maximum of 1/u)
  })

  it('refuses to write a document it cannot validate', async () => {
    await mount()

    await expect(ctx.agentTeamLlm.saveWorkspaceDocument(repo, JSON.parse('{"version": 1, "enabled": "yes"}') as TeamDocument))
      .rejects.toThrow(/team\.json/u)
    expect(ctx.agentTeamLlm.readWorkspaceDocument(repo)).toBeUndefined()
  })

  it('replaces the document atomically and leaves no temporary sibling', async () => {
    await mount()
    await ctx.agentTeamLlm.saveWorkspaceDocument(repo, {
      version: 1,
      members: [{ name: 'recon', description: 'First roster.' }],
    })
    await ctx.agentTeamLlm.saveWorkspaceDocument(repo, {
      version: 1,
      members: [{ name: 'recon', description: 'Second roster.' }],
    })

    expect(await readdir(join(repo, '.dsh'))).toEqual(['team.json'])
    expect(await readFile(join(repo, '.dsh', 'team.json'), 'utf8')).toContain('Second roster.')
    expect(ctx.agentTeamLlm.resolveFor(repo).members[0]?.description).toBe('Second roster.')
  })

  /** Register one directory as the directory one Workspace identity resolves to. */
  function provideWorkspace(workspaceId: WorkspaceId, path: string): void {
    // The registry class owns private state, so a stand-in covering only `get`
    // cannot be structurally assigned to the service property.
    ctx.provide('workspaceRegistry', {
      get: (id: WorkspaceId) => id === workspaceId ? { path } : undefined,
    } as never)
  }

  const workspaceId = 'ws-1' as WorkspaceId
  const signal = new AbortController().signal

  it('writes and reads the document of a registered workspace through the Remote', async () => {
    await mount()
    provideWorkspace(workspaceId, repo)

    await expect(ctx.agentTeamLlm.saveTeamDocument(workspaceId, { version: 1, enabled: false }, signal))
      .resolves.toEqual({ path: join(repo, '.dsh', 'team.json') })
    expect(ctx.agentTeamLlm.readTeamDocument(workspaceId, signal))
      .toEqual({ path: join(repo, '.dsh', 'team.json'), document: { version: 1, enabled: false } })
  })

  it('reports the document path with no document through the Remote', async () => {
    await mount()
    provideWorkspace(workspaceId, repo)

    expect(ctx.agentTeamLlm.readTeamDocument(workspaceId, signal))
      .toEqual({ path: join(repo, '.dsh', 'team.json'), document: null })
  })

  it('reports a document path that exists but cannot be read as a file', async () => {
    await mount()
    await mkdir(join(repo, '.dsh', 'team.json'), { recursive: true })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(/EISDIR/u)
  })

  it('reports a Remote write failure that is not a document rejection', async () => {
    await mount()
    provideWorkspace(workspaceId, repo)
    await mkdir(join(repo, '.dsh', 'team.json'), { recursive: true })

    await expect(ctx.agentTeamLlm.saveTeamDocument(workspaceId, { version: 1 }, signal))
      .rejects.toThrow(/team\.json/u)
  })

  it('reports no document path when the registered workspace has no project root', async () => {
    await mount()
    const detached = await mkdtemp(join(tmpdir(), 'dsh-team-detached-'))
    const detachedId = 'ws-detached' as WorkspaceId
    provideWorkspace(detachedId, detached)

    try {
      expect(ctx.agentTeamLlm.readTeamDocument(detachedId, signal)).toEqual({ path: null, document: null })
      const failure = await ctx.agentTeamLlm.saveTeamDocument(detachedId, { version: 1 }, signal)
        .catch((error: unknown) => error)
      expect(remoteErrorOf(failure)?.code).toBe('team-document/no-project-root')
      expect(remoteErrorOf(failure)?.message).toMatch(/no \.git ancestor/u)
    } finally {
      await rm(detached, { recursive: true, force: true })
    }
  })

  it('refuses a Workspace identity the registry does not know', async () => {
    await mount()
    provideWorkspace(workspaceId, repo)
    const unknown = 'ws-missing' as WorkspaceId

    expect(failureCode(() => ctx.agentTeamLlm.readTeamDocument(unknown, signal)))
      .toBe('team-document/unknown-workspace')
    await expect(ctx.agentTeamLlm.saveTeamDocument(unknown, { version: 1 }, signal))
      .rejects.toMatchObject({ code: 'team-document/unknown-workspace' })
  })

  it('refuses a workspace document call when the composition mounts no Workspace registry', async () => {
    await mount()

    expect(failureCode(() => ctx.agentTeamLlm.readTeamDocument(workspaceId, signal)))
      .toBe('team-document/no-workspace-registry')
    await expect(ctx.agentTeamLlm.saveTeamDocument(workspaceId, { version: 1 }, signal))
      .rejects.toMatchObject({ code: 'team-document/no-workspace-registry' })
  })

  it('reports a rejected Remote document write', async () => {
    await mount()
    provideWorkspace(workspaceId, repo)

    const failure = await ctx.agentTeamLlm.saveTeamDocument(
      workspaceId,
      { version: 1, members: [{ name: 'Recon', description: 'Reads.' }] },
      signal,
    ).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.code).toBe('team-document/invalid')
    expect(remoteErrorOf(failure)?.message).toMatch(/team\.json members\[0\]\.name: "Recon" must match/u)
  })

  it('honors a canceled Remote call', async () => {
    await mount()
    provideWorkspace(workspaceId, repo)
    const aborted = new AbortController()
    aborted.abort()

    expect(() => ctx.agentTeamLlm.readTeamDocument(workspaceId, aborted.signal)).toThrow(/aborted/u)
    await expect(ctx.agentTeamLlm.saveTeamDocument(workspaceId, { version: 1 }, aborted.signal)).rejects.toThrow(/aborted/u)
  })

  it('reports a malformed document as a decoding failure', async () => {
    await mount()
    await mkdir(join(repo, '.dsh'), { recursive: true })
    await writeFile(join(repo, '.dsh', 'team.json'), '{ not json', 'utf8')

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(/is not JSON/u)
  })
})

/**
 * The per-member sandbox scope, across the global layer, the workspace document,
 * and the by-name merge. Each case stages the field it asserts, so removing the
 * sandbox handling from any layer turns the matching case red rather than
 * leaving an empty roster on both sides of the comparison.
 */
describe('agent-team-llm-settings member sandbox scope', () => {
  let root: string
  let repo: string
  let ctx: Context

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-team-sandbox-'))
    repo = join(root, 'repo')
    await mkdir(join(repo, '.git'), { recursive: true })
    ctx = await testContext()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  /** Write raw JSON as the workspace document, bypassing every write path. */
  async function writeRaw(value: unknown): Promise<void> {
    await mkdir(join(repo, '.dsh'), { recursive: true })
    await writeFile(join(repo, '.dsh', 'team.json'), JSON.stringify(value), 'utf8')
  }

  it('resolves a global member sandbox scope, and omits it when none is declared', async () => {
    const withMode = await testContext()
    await withMode.plugin(AgentTeamLlmSettings, {
      members: [
        { name: 'recon', description: 'Reads.', sandboxMode: 'read-only' },
        { name: 'writer', description: 'Writes.', sandboxMode: 'workspace-write' },
        { name: 'admin', description: 'Full.', sandboxMode: 'danger-full-access' },
        { name: 'scout', description: 'No declared scope.' },
      ],
    })

    expect(withMode.agentTeamLlm.current().members).toEqual([
      { name: 'recon', description: 'Reads.', context: 'fresh', sandboxMode: 'read-only' },
      { name: 'writer', description: 'Writes.', context: 'fresh', sandboxMode: 'workspace-write' },
      { name: 'admin', description: 'Full.', context: 'fresh', sandboxMode: 'danger-full-access' },
      { name: 'scout', description: 'No declared scope.', context: 'fresh' },
    ])
    // An undeclared scope must leave the key absent, not carry an empty string.
    expect(withMode.agentTeamLlm.current().members[3]).not.toHaveProperty('sandboxMode')

    await withMode.fiber.dispose()
  })

  it('refuses a global member sandbox scope outside the three modes at the Config layer', async () => {
    const ctx = await testContext()
    // The reachable contract: `memberSchema` is a three-value union, so an
    // unknown scope never reaches `resolveMembers`; the mount itself is refused
    // and the message names the offending field.
    await expect(ctx.plugin(AgentTeamLlmSettings, {
      // @ts-expect-error an out-of-union scope only arrives from untyped configuration
      members: [{ name: 'recon', description: 'Reads.', sandboxMode: 'sudo' }],
    })).rejects.toThrow(/members\[0\]\.sandboxMode expected "read-only" \| "workspace-write" \| "danger-full-access" but got "sudo"/u)

    await ctx.fiber.dispose()
  })

  it('reads a member sandbox scope out of the workspace document', async () => {
    await ctx.plugin(AgentTeamLlmSettings, {})
    await writeRaw({
      version: 1,
      members: [{ name: 'recon', description: 'Reads.', sandboxMode: 'danger-full-access' }],
    })

    expect(ctx.agentTeamLlm.resolveFor(repo).members[0]).toEqual({
      name: 'recon',
      description: 'Reads.',
      context: 'fresh',
      sandboxMode: 'danger-full-access',
    })
  })

  it('rejects a member sandbox scope outside the three modes, naming the field', async () => {
    await ctx.plugin(AgentTeamLlmSettings, {})
    await writeRaw({
      version: 1,
      members: [{ name: 'recon', description: 'Reads.', sandboxMode: 'sudo' }],
    })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(
      /team\.json members\[0\]\.sandboxMode: must be "read-only", "workspace-write", or "danger-full-access"/u,
    )
  })

  it('overrides the global sandbox scope for a same-named workspace member', async () => {
    await ctx.plugin(AgentTeamLlmSettings, {
      members: [
        { name: 'recon', description: 'Global recon.', sandboxMode: 'read-only' },
        { name: 'writer', description: 'Global writer.', sandboxMode: 'read-only' },
      ],
    })
    await writeRaw({
      version: 1,
      members: [
        { name: 'recon', description: 'Workspace recon.', sandboxMode: 'danger-full-access' },
        // declares no scope of its own, so the global entry keeps its own
        { name: 'writer', description: 'Workspace writer.' },
      ],
    })

    const members = ctx.agentTeamLlm.resolveFor(repo).members

    expect(members.map(member => ({ name: member.name, description: member.description, sandboxMode: member.sandboxMode }))).toEqual([
      { name: 'recon', description: 'Workspace recon.', sandboxMode: 'danger-full-access' },
      { name: 'writer', description: 'Workspace writer.', sandboxMode: undefined },
    ])
    // The declared override replaced the entry in place, so global order holds.
    expect(members.map(member => member.name)).toEqual(['recon', 'writer'])
  })

  it('inherits the global sandbox scope when the workspace document declares none', async () => {
    await ctx.plugin(AgentTeamLlmSettings, {
      enabled: true,
      allowedRoutes: [ROUTE],
      members: [{ name: 'recon', description: 'Global recon.', sandboxMode: 'workspace-write' }],
    })
    await writeRaw({ version: 1 })

    const members = ctx.agentTeamLlm.resolveFor(repo).members

    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ name: 'recon', sandboxMode: 'workspace-write' })
  })

  it('appends a workspace-only member carrying its own sandbox scope', async () => {
    await ctx.plugin(AgentTeamLlmSettings, {
      members: [{ name: 'recon', description: 'Global recon.', sandboxMode: 'read-only' }],
    })
    await writeRaw({
      version: 1,
      members: [{ name: 'builder', description: 'Builds.', sandboxMode: 'danger-full-access' }],
    })

    const members = ctx.agentTeamLlm.resolveFor(repo).members

    expect(members.map(member => member.name)).toEqual(['recon', 'builder'])
    expect(members[1]).toMatchObject({ name: 'builder', sandboxMode: 'danger-full-access' })
    expect(members[0]).toMatchObject({ name: 'recon', sandboxMode: 'read-only' })
  })
})

/**
 * The per-member approval policy, across the global layer, the workspace
 * document, and the by-name merge. The policy is the second knob of a member's
 * permissions pair, so each case stages it alone: an undeclared policy stays
 * absent, an illegal one is refused by field, and a same-named workspace entry
 * replaces the whole global entry rather than merging field by field.
 */
describe('agent-team-llm-settings member approval policy', () => {
  let root: string
  let repo: string
  let ctx: Context

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-team-approval-'))
    repo = join(root, 'repo')
    await mkdir(join(repo, '.git'), { recursive: true })
    ctx = await testContext()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  /** Write raw JSON as the workspace document, bypassing every write path. */
  async function writeRaw(value: unknown): Promise<void> {
    await mkdir(join(repo, '.dsh'), { recursive: true })
    await writeFile(join(repo, '.dsh', 'team.json'), JSON.stringify(value), 'utf8')
  }

  it('resolves a global member approval policy, and omits it when none is declared', async () => {
    const withPolicy = await testContext()
    await withPolicy.plugin(AgentTeamLlmSettings, {
      members: [
        { name: 'recon', description: 'Reads.', approvalPolicy: 'never' },
        { name: 'writer', description: 'Writes.', approvalPolicy: 'ask' },
        { name: 'scout', description: 'No declared policy.' },
      ],
    })

    expect(withPolicy.agentTeamLlm.current().members).toEqual([
      { name: 'recon', description: 'Reads.', context: 'fresh', approvalPolicy: 'never' },
      { name: 'writer', description: 'Writes.', context: 'fresh', approvalPolicy: 'ask' },
      { name: 'scout', description: 'No declared policy.', context: 'fresh' },
    ])
    // An undeclared policy must leave the key absent, not carry an empty string.
    expect(withPolicy.agentTeamLlm.current().members[2]).not.toHaveProperty('approvalPolicy')

    await withPolicy.fiber.dispose()
  })

  it('refuses a global member approval policy outside the two policies at the Config layer', async () => {
    const ctx = await testContext()
    // The reachable contract: `memberSchema` is a two-value union, so an unknown
    // policy never reaches `resolveMembers`; the mount itself is refused and the
    // message names the offending field.
    await expect(ctx.plugin(AgentTeamLlmSettings, {
      // @ts-expect-error an out-of-union policy only arrives from untyped configuration
      members: [{ name: 'recon', description: 'Reads.', approvalPolicy: 'sudo' }],
    })).rejects.toThrow(/members\[0\]\.approvalPolicy expected "ask" \| "never" but got "sudo"/u)

    await ctx.fiber.dispose()
  })

  it('reads a member approval policy out of the workspace document', async () => {
    await ctx.plugin(AgentTeamLlmSettings, {})
    await writeRaw({
      version: 1,
      members: [{ name: 'recon', description: 'Reads.', approvalPolicy: 'never' }],
    })

    expect(ctx.agentTeamLlm.resolveFor(repo).members[0]).toEqual({
      name: 'recon',
      description: 'Reads.',
      context: 'fresh',
      approvalPolicy: 'never',
    })
  })

  it('rejects a member approval policy outside the two policies, naming the field', async () => {
    await ctx.plugin(AgentTeamLlmSettings, {})
    await writeRaw({
      version: 1,
      members: [{ name: 'recon', description: 'Reads.', approvalPolicy: 'sudo' }],
    })

    expect(() => ctx.agentTeamLlm.readWorkspaceDocument(repo)).toThrow(
      /team\.json members\[0\]\.approvalPolicy: must be "ask" or "never"/u,
    )
  })

  it('replaces the whole global entry for a same-named workspace member', async () => {
    await ctx.plugin(AgentTeamLlmSettings, {
      members: [
        { name: 'recon', description: 'Global recon.', sandboxMode: 'read-only', approvalPolicy: 'never' },
        { name: 'writer', description: 'Global writer.', approvalPolicy: 'never' },
      ],
    })
    await writeRaw({
      version: 1,
      members: [
        { name: 'recon', description: 'Workspace recon.', sandboxMode: 'workspace-write', approvalPolicy: 'ask' },
        // declares no policy of its own, so it must not inherit the global one
        { name: 'writer', description: 'Workspace writer.' },
      ],
    })

    const members = ctx.agentTeamLlm.resolveFor(repo).members

    expect(members.map(member => ({
      name: member.name,
      description: member.description,
      sandboxMode: member.sandboxMode,
      approvalPolicy: member.approvalPolicy,
    }))).toEqual([
      { name: 'recon', description: 'Workspace recon.', sandboxMode: 'workspace-write', approvalPolicy: 'ask' },
      { name: 'writer', description: 'Workspace writer.', sandboxMode: undefined, approvalPolicy: undefined },
    ])
    // The declared entry replaced the global one in place, so global order holds.
    expect(members.map(member => member.name)).toEqual(['recon', 'writer'])
  })
})

describe('agent-team-llm-settings member permission presets', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await testContext()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  const signal = new AbortController().signal

  /** The three reads this Remote makes on the composed permission domain. */
  type PresetReads = Pick<PermissionPresetService, 'catalog' | 'optionOf' | 'resolve'>

  function providePresetReads(reads: PresetReads): void {
    // The service class owns private state, so a stand-in covering only these
    // three reads cannot be structurally assigned to the service property.
    ctx.provide('permissionPresets', reads as never)
  }

  it('offers nothing and the derived custom name without a permission domain', async () => {
    await ctx.plugin(AgentTeamLlmSettings, { allowedRoutes: [ROUTE] })

    expect(ctx.agentTeamLlm.listMemberPermissionPresets(signal)).toEqual({
      presets: [],
      custom: { name: 'custom', label: 'custom' },
    })
  })

  it('reports every configured default with its knobs and the permission domain copy', async () => {
    providePresetReads({
      // A live option such as Auto is not a durable roster identity, so only
      // `defaultOptions` may reach a member row.
      catalog: () => ({
        options: [{ value: 'auto', name: 'Auto' }],
        defaultOptions: [
          { value: 'workspace-write', name: 'Workspace write', description: 'Write inside the workspace.' },
          { value: 'danger-full-access', name: 'Full access' },
        ],
        defaultPreset: 'workspace-write',
      }),
      resolve: name => name === 'danger-full-access'
        ? { sandbox: 'danger-full-access', approval: 'never' }
        : { sandbox: 'workspace-write', approval: 'ask' },
      optionOf: name => ({
        value: name, name: 'Custom', description: 'The current knobs match no configured preset.',
      }),
    })
    await ctx.plugin(AgentTeamLlmSettings, { allowedRoutes: [ROUTE] })

    expect(ctx.agentTeamLlm.listMemberPermissionPresets(signal)).toEqual({
      presets: [
        {
          name: 'workspace-write', label: 'Workspace write',
          sandbox: 'workspace-write', approval: 'ask', description: 'Write inside the workspace.',
        },
        { name: 'danger-full-access', label: 'Full access', sandbox: 'danger-full-access', approval: 'never' },
      ],
      custom: {
        name: 'custom', label: 'Custom', description: 'The current knobs match no configured preset.',
      },
    })
  })

  it('omits a description the permission domain configured none for', async () => {
    providePresetReads({
      catalog: () => ({ options: [], defaultOptions: [{ value: 'read-only', name: 'Read only' }], defaultPreset: 'read-only' }),
      resolve: () => ({ sandbox: 'read-only', approval: 'ask' }),
      optionOf: () => ({ value: 'custom', name: 'custom' }),
    })
    await ctx.plugin(AgentTeamLlmSettings, { allowedRoutes: [ROUTE] })

    const catalog = ctx.agentTeamLlm.listMemberPermissionPresets(signal)

    expect(catalog.presets).toEqual([
      { name: 'read-only', label: 'Read only', sandbox: 'read-only', approval: 'ask' },
    ])
    expect('description' in catalog.presets[0]!).toBe(false)
    expect(catalog.custom).toEqual({ name: 'custom', label: 'custom' })
    expect('description' in catalog.custom).toBe(false)
  })

  it('honors a canceled preset listing', async () => {
    await ctx.plugin(AgentTeamLlmSettings, { allowedRoutes: [ROUTE] })

    expect(() => ctx.agentTeamLlm.listMemberPermissionPresets(AbortSignal.abort())).toThrow()
  })
})

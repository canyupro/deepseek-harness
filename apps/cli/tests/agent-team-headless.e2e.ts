import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const fixturePlugin = pathToFileURL(fileURLToPath(
  new URL('./profiles/headless/tests/fixtures/team-llm.mjs', import.meta.url),
)).href
const routeFixturePlugin = pathToFileURL(fileURLToPath(
  new URL('./profiles/headless/tests/fixtures/team-route-llm.mjs', import.meta.url),
)).href
const sandboxFixturePlugin = pathToFileURL(fileURLToPath(
  new URL('./profiles/headless/tests/fixtures/team-sandbox-llm.mjs', import.meta.url),
)).href

/** Compose one keyless headless profile over an isolated home. */
async function writeProfile(cwd: string, fixture: string, extraPatch: readonly string[] = []): Promise<{ home: string; sessions: string }> {
  const home = join(cwd, '.dsh')
  const sessions = join(home, 'sessions')
  const profileDir = join(home, 'profiles', 'headless')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-experimental-agent-team-profile': 'workspace:^',
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-headless',
          '@deepseek-ai/dsh-experimental-agent-team-profile',
        ],
      },
    },
  }, undefined, 2) + '\n')
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- id: llm-deepseek',
    '  disabled: true',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: '${sessions}'`,
    '    compression: none',
    '- insert:',
    '    - id: team-fixture-llm',
    `      name: '${fixture}'`,
    ...extraPatch,
    '',
  ].join('\n'))
  return { home, sessions }
}

/** Launch one task through the shipped headless profile over one isolated home. */
function launch(cwd: string, home: string, task: string) {
  const resolved = resolveExampleLaunch({
    srcBin: dshBinScript,
    configArgs: ['--profile', 'headless', task],
    tsconfigPath,
    env: {
      DSH_HOME: home,
      DSH_AGENTS_HOME: join(cwd, '.agents'),
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: '',
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        '--disable-warning=ExperimentalWarning',
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      ].filter(Boolean).join(' '),
    },
  })
  return execa(resolved.command, resolved.args, {
    cwd,
    env: resolved.env,
    input: '',
    timeout: 90_000,
    killSignal: 'SIGKILL',
    reject: false,
  })
}

function records(content: string): Record<string, unknown>[] {
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('dsh run with Agent Teams enabled', () => {
  it('runs two teammates, durable peer mail, dependent tasks, waiting, and final aggregation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-agent-team-headless-'))
    try {
      const { home, sessions } = await writeProfile(cwd, fixturePlugin)
      const result = await launch(cwd, home, '请先运行 workflow 检查，再使用 Agent Teams 把调研和实现拆给两个 teammate，等待完成后汇总。')
      expect(
        result.exitCode,
        `dsh headless profile exited unexpectedly.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('TEAM_WORKFLOW_OK')

      const files = (await readdir(sessions, { recursive: true }))
        .filter(file => file.endsWith('.jsonl'))
      expect(files).toHaveLength(4)
      const logs = await Promise.all(files.map(file => readFile(join(sessions, file), 'utf8')))
      const parsed = logs.map(records)
      const workflowChild = parsed.find(log => log.some(record => record.type === 'subagent/descriptor'
        && (record.data as { mode: string }).mode === 'one-shot'))
      expect(workflowChild).toBeDefined()
      expect(workflowChild!.find(record => record.type === 'subagent/descriptor')?.data)
        .toMatchObject({ mode: 'one-shot', provider: 'spawn' })
      expect(workflowChild!.filter(record => record.type === 'user/message'
        && (record.data as { source: { kind: string } }).source.kind === 'user').map(record => record.data))
        .toEqual([expect.objectContaining({ content: [{ type: 'text', text: 'TEAM_WORKFLOW_CHILD' }] })])
      const root = parsed.find((log) => {
        const header = log[0]
        return header?.type === 'session' && typeof header.parentSession !== 'string'
      })
      expect(root).toBeDefined()
      const eventTypes = root!.map(record => record.type)
      expect(eventTypes.filter(type => type === 'team/member')).toHaveLength(4)
      expect(eventTypes).toContain('team/message/queued')
      expect(eventTypes).toContain('team/message/delivered')
      const taskEvents = root!.filter(record => record.type === 'team/task')
      expect(taskEvents.filter((record) => {
        const data = record.data as { task?: { status?: string } } | undefined
        return data?.task?.status === 'completed'
      })).toHaveLength(2)
      const toolNames = root!.filter(record => record.type === 'tool/call')
        .map(record => (record.data as { name?: string } | undefined)?.name)
      expect(toolNames).toContain('wait_agent')
      expect(toolNames).toContain('team_task_list')
      expect(toolNames).toContain('list_agents')
      expect(toolNames).toContain('workflow')
      expect(root!.find(record => record.type === 'tool-workflow/run-end')?.data)
        .toMatchObject({ stopReason: 'completed' })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 105_000)

  it('applies a member-declared sandbox scope to that member only', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-agent-team-sandbox-'))
    try {
      const { home, sessions } = await writeProfile(cwd, sandboxFixturePlugin, [
        // A distinctive team default, so the plain member's own event cannot be
        // confused with the shipped default value.
        '- id: agent-team',
        '  config:',
        '    memberSandboxMode: danger-full-access',
        '- id: agent-team-llm-settings',
        '  name: \'@deepseek-ai/dsh-experimental-agent-team-llm-settings\'',
        '  config:',
        '    enabled: true',
        '    allowedRoutes:',
        '      - provider: deepseek-official',
        '        model: team-sandbox-model',
        '    members:',
        '      - name: scoped',
        '        description: Owns the work under an explicit read-only scope.',
        '        sandboxMode: read-only',
        '        provider: deepseek-official',
        '        model: team-sandbox-model',
        '      - name: plain',
        '        description: Owns the work under the team default scope.',
        '        provider: deepseek-official',
        '        model: team-sandbox-model',
      ])
      const result = await launch(cwd, home, 'Create the whole configured team roster and wait for it.')
      expect(
        result.exitCode,
        `dsh headless profile exited unexpectedly.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('TEAM_SANDBOX_OK')

      const logs = (await Promise.all((await readdir(sessions, { recursive: true }))
        .filter(file => file.endsWith('.jsonl'))
        .map(file => readFile(join(sessions, file), 'utf8')))).map(records)

      /** The child session whose first prompt names the given teammate. */
      const childOf = (name: string) => logs.find(log => log.some(record =>
        record.type === 'user/message'
        && (record.data as { source?: { kind?: string } }).source?.kind === 'user'
        && (record.data as { content?: { text?: string }[] }).content?.some(block => block.text?.includes(`You are teammate "${name}"`)),
      ))
      const modesOf = (name: string) => childOf(name)!
        .filter(record => record.type === 'sandbox/mode')
        .map(record => record.data)

      // The declaring member carries its own scope, sourced from the delegation.
      expect(modesOf('scoped')).toEqual([{ mode: 'read-only', source: 'delegation' }])
      // The member that declared nothing falls back to the team default, so the
      // scope is applied per member rather than as one team-wide switch.
      expect(modesOf('plain')).toEqual([{ mode: 'danger-full-access', source: 'delegation' }])

      /** Every policy event one member's session recorded, in order. */
      const policyEvents = (name: string) => childOf(name)!
        .filter(record => record.type === 'sandbox/mode' || record.type === 'approval/policy' || record.type === 'permission/preset')
        .map(record => record.data as Record<string, unknown>)

      // The declaring member runs read-only, sourced from the delegation.
      expect(modesOf('scoped')).toEqual([{ mode: 'read-only', source: 'delegation' }])
      // The member that declared nothing keeps the team default, so the scope is
      // applied per member rather than as one team-wide switch.
      expect(modesOf('plain')).toEqual([{ mode: 'danger-full-access', source: 'delegation' }])
      // Both members approve nothing, whatever their scope.
      expect(policyEvents('scoped')).toContainEqual({ policy: 'never', source: 'delegation' })
      expect(policyEvents('plain')).toContainEqual({ policy: 'never', source: 'delegation' })
      // No member is handed the `auto` preset: the read-only member carries no
      // preset at all, and the default-scoped member's preset matches its scope.
      expect(policyEvents('scoped').filter(data => 'preset' in data)).toEqual([])
      expect(policyEvents('plain').filter(data => 'preset' in data))
        .toEqual([{ preset: 'danger-full-access' }])
      for (const name of ['scoped', 'plain']) {
        expect(policyEvents(name).filter(data => 'preset' in data && data.preset === 'auto')).toEqual([])
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 105_000)

  it('runs teammates on a named and a configured LLM route while the Lead keeps its own', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-agent-team-route-'))
    try {
      const { home, sessions } = await writeProfile(cwd, routeFixturePlugin, [
        '- id: agent-team-llm-settings',
        '  name: \'@deepseek-ai/dsh-experimental-agent-team-llm-settings\'',
        '  config:',
        '    enabled: true',
        '    allowedRoutes:',
        '      - provider: deepseek-official',
        '        model: team-route-model',
        '      - provider: deepseek-official',
        '        model: team-preset-model',
        '    roleRoutes:',
        '      - name: preset-owner',
        '        provider: deepseek-official',
        '        model: team-preset-model',
      ])
      const result = await launch(cwd, home, 'Route two units of work to teammates.')
      expect(
        result.exitCode,
        `dsh headless profile exited unexpectedly.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0)
      expect(result.stdout).toContain('TEAM_ROUTE_OK')

      const logs = await Promise.all((await readdir(sessions, { recursive: true }))
        .filter(file => file.endsWith('.jsonl'))
        .map(file => readFile(join(sessions, file), 'utf8')))
      const parsed = logs.map(records)
      const descriptor = parsed
        .flatMap(log => log.filter(record => record.type === 'subagent/descriptor'))
        .map(record => record.data)
      expect(descriptor).toEqual(expect.arrayContaining([
        expect.objectContaining({
          mode: 'continuable',
          provider: 'spawn',
          agentProvider: 'deepseek-official',
          agentModel: 'team-route-model',
        }),
        expect.objectContaining({
          mode: 'continuable',
          provider: 'spawn',
          agentProvider: 'deepseek-official',
          agentModel: 'team-preset-model',
        }),
      ]))
      expect(descriptor).toHaveLength(2)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 105_000)
})

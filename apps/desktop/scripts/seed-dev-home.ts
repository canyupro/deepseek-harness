/**
 * Seed a development `$DSH_HOME` with this checkout's tracked personal
 * configuration.
 *
 * A fresh clone has no profile directory, so the launcher would compose the
 * default product: none of this fork's deployment rows, no global instructions,
 * no agent presets, and no installed skills. Each tracked copy lands only where
 * its target is absent, so a machine that already owns a `$DSH_HOME` keeps every
 * file and directory it has. `DSH_DESKTOP_SEED=0` skips the seeding entirely.
 */
import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root that owns the tracked seed. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** One tracked source and the `$DSH_HOME` path it seeds. */
interface SeedCopy {
  readonly source: string
  readonly target: string
}

/**
 * Resolve the tracked sources against the target home.
 * @param home - absolute `$DSH_HOME` the launcher passes to the app.
 * @param repositoryRoot - checkout whose tracked copies are the seed.
 * @returns every source-to-target pair, in copy order.
 */
function seedCopies(home: string, repositoryRoot: string): readonly SeedCopy[] {
  return [
    { source: join(repositoryRoot, '.dsh/dev-home/AGENTS.md'), target: join(home, 'AGENTS.md') },
    { source: join(repositoryRoot, '.dsh/dev-home/.agent-presets'), target: join(home, '.agent-presets') },
    { source: join(repositoryRoot, '.dsh/dev-home/skills'), target: join(home, 'skills') },
    { source: join(repositoryRoot, '.dsh/profile.patch.yml'), target: join(home, 'profiles/desktop/cordis.patch.yml') },
  ]
}

/**
 * Copy this checkout's personal configuration into `home` where it is missing.
 * @param home - absolute `$DSH_HOME` the launcher passes to the app.
 * @param repositoryRoot - checkout whose tracked copies are the seed.
 * @returns the absolute target paths this call created, in copy order.
 */
export async function seedDevelopmentHome(home: string, repositoryRoot: string = REPOSITORY_ROOT): Promise<readonly string[]> {
  const created: string[] = []
  for (const { source, target } of seedCopies(home, repositoryRoot)) {
    if (!existsSync(source) || existsSync(target)) continue
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true })
    created.push(target)
  }
  return created
}

/**
 * Run the seeder for one home on its own, so a checkout can be prepared without
 * launching the app.
 * @returns after every missing target is copied.
 */
async function main(): Promise<void> {
  const home = resolve(process.argv[2] ?? process.env.DSH_HOME ?? join(REPOSITORY_ROOT, 'apps/desktop/.desktop-build/development/home'))
  const created = await seedDevelopmentHome(home)
  console.log(created.length === 0
    ? `seed-dev-home: ${home} already carries every seeded path`
    : `seed-dev-home: wrote ${String(created.length)} path(s) into ${home}\n${created.map(path => `  ${path}`).join('\n')}`)
}

/* v8 ignore next 3 -- the launcher imports the export and never runs this entry. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}

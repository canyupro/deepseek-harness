import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  emptyLibrary,
  findLibraryPlugin,
  libraryPath,
  loadLibrary,
  removeLibraryPlugin,
  saveLibrary,
  upsertLibraryPlugin,
  type LibraryPluginRecord,
} from '../src/library-store.ts'

/**
 * The durable personal-plugin library document: path derivation, the absent
 * file reading as an empty library, atomic persistence round-tripping source
 * halves and approval state, and loud failure on a malformed document.
 */

const PLUGIN: LibraryPluginRecord = {
  pluginId: 'lib-1',
  sessionId: 'sess',
  name: 'prompt-enhance',
  purpose: 'enhance the current draft',
  state: 'on-editable',
  currentPackageId: 'pkg-2',
  approvedClientPackages: ['pkg-1'],
  clientVersionUpdatesApproved: true,
  packages: [
    { packageId: 'pkg-1', name: 'prompt-enhance', purpose: 'v1', hostCode: 'return {}' },
    { packageId: 'pkg-2', name: 'prompt-enhance', purpose: 'v2', clientCode: 'return {}' },
  ],
}

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-library-'))
}

describe('library path', () => {
  it('derives the document path under the plugins directory', () => {
    expect(libraryPath('/home/user/.dsh')).toBe('/home/user/.dsh/plugins/library.json')
  })
})

describe('loadLibrary', () => {
  it('reads an absent file as an empty library', () => {
    const home = tempHome()
    try {
      expect(loadLibrary(home)).toEqual(emptyLibrary())
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('round-trips a persisted document with source halves and approval state', () => {
    const home = tempHome()
    try {
      saveLibrary(home, { version: 1, plugins: [PLUGIN] })
      expect(loadLibrary(home)).toEqual({ version: 1, plugins: [PLUGIN] })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('fails loudly on a malformed document', () => {
    const home = tempHome()
    try {
      mkdirSync(join(home, 'plugins'), { recursive: true })
      writeFileSync(libraryPath(home), '{ not json', 'utf8')
      expect(() => loadLibrary(home)).toThrow(SyntaxError)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('fails loudly on a document with an unexpected shape', () => {
    const home = tempHome()
    try {
      mkdirSync(join(home, 'plugins'), { recursive: true })
      writeFileSync(libraryPath(home), JSON.stringify({ version: 99, plugins: 'nope' }), 'utf8')
      expect(() => loadLibrary(home)).toThrow(/corrupt personal plugin library/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rejects every malformed document field at the durable boundary', () => {
    const home = tempHome()
    try {
      mkdirSync(join(home, 'plugins'), { recursive: true })
      const overrides: Array<[string, unknown]> = [
        ['non-record document', '"nope"'],
        ['bad version', { version: 2, plugins: [] }],
        ['plugins not an array', { version: 1, plugins: 'nope' }],
        ['plugin not a record', { version: 1, plugins: ['nope'] }],
        ['pluginId not a string', { version: 1, plugins: [{ ...PLUGIN, pluginId: 1 }] }],
        ['name not a string', { version: 1, plugins: [{ ...PLUGIN, name: 1 }] }],
        ['purpose not a string', { version: 1, plugins: [{ ...PLUGIN, purpose: 1 }] }],
        ['state invalid', { version: 1, plugins: [{ ...PLUGIN, state: 'running' }] }],
        ['currentPackageId not optional string', { version: 1, plugins: [{ ...PLUGIN, currentPackageId: 1 }] }],
        ['approvedClientPackages not an array', { version: 1, plugins: [{ ...PLUGIN, approvedClientPackages: 'x' }] }],
        ['approvedClientPackages with non-string', { version: 1, plugins: [{ ...PLUGIN, approvedClientPackages: [1] }] }],
        ['clientVersionUpdatesApproved not boolean', { version: 1, plugins: [{ ...PLUGIN, clientVersionUpdatesApproved: 'yes' }] }],
        ['packages not an array', { version: 1, plugins: [{ ...PLUGIN, packages: 'nope' }] }],
        ['package not a record', { version: 1, plugins: [{ ...PLUGIN, packages: ['nope'] }] }],
        ['packageId not a string', { version: 1, plugins: [{ ...PLUGIN, packages: [{ ...PLUGIN.packages[0], packageId: 1 }] }] }],
        ['package name not a string', { version: 1, plugins: [{ ...PLUGIN, packages: [{ ...PLUGIN.packages[0], name: 1 }] }] }],
        ['package purpose not a string', { version: 1, plugins: [{ ...PLUGIN, packages: [{ ...PLUGIN.packages[0], purpose: 1 }] }] }],
        ['hostCode not optional string', { version: 1, plugins: [{ ...PLUGIN, packages: [{ ...PLUGIN.packages[0], hostCode: 1 }] }] }],
        ['clientCode not optional string', { version: 1, plugins: [{ ...PLUGIN, packages: [{ ...PLUGIN.packages[0], clientCode: 1 }] }] }],
      ]
      for (const [label, document] of overrides) {
        writeFileSync(libraryPath(home), JSON.stringify(document), 'utf8')
        expect(loadLibrary.bind(null, home), label).toThrow(/corrupt personal plugin library/)
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('saveLibrary', () => {
  it('creates the plugins directory and persists atomically', () => {
    const home = tempHome()
    try {
      saveLibrary(home, { version: 1, plugins: [PLUGIN] })
      expect(loadLibrary(home).plugins).toHaveLength(1)
      expect(loadLibrary(home).plugins[0]?.packages[1]?.clientCode).toBe('return {}')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('replaces the previous document on the next save', () => {
    const home = tempHome()
    try {
      saveLibrary(home, { version: 1, plugins: [PLUGIN] })
      saveLibrary(home, { version: 1, plugins: [] })
      expect(loadLibrary(home).plugins).toHaveLength(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('document helpers', () => {
  it('finds a persisted plugin by identity', () => {
    const doc = { version: 1 as const, plugins: [PLUGIN] }
    expect(findLibraryPlugin(doc, 'lib-1')?.state).toBe('on-editable')
    expect(findLibraryPlugin(doc, 'missing')).toBeUndefined()
  })

  it('inserts a new plugin and replaces an existing one in place', () => {
    const doc = { version: 1 as const, plugins: [PLUGIN] }
    upsertLibraryPlugin(doc, { ...PLUGIN, pluginId: 'lib-2', state: 'off' })
    expect(doc.plugins).toHaveLength(2)
    upsertLibraryPlugin(doc, { ...PLUGIN, state: 'frozen' })
    expect(doc.plugins).toHaveLength(2)
    expect(doc.plugins[0]?.state).toBe('frozen')
  })

  it('removes a persisted plugin and reports absence', () => {
    const doc = { version: 1 as const, plugins: [PLUGIN] }
    expect(removeLibraryPlugin(doc, 'lib-1')).toBe(true)
    expect(doc.plugins).toHaveLength(0)
    expect(removeLibraryPlugin(doc, 'lib-1')).toBe(false)
  })
})

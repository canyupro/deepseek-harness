/**
 * Durable personal-plugin library: the JSON document persisted under the host
 * home that records every plugin the user saved from the dynamic runner.
 * Lifecycle states map to the runner's authorization model — `on-editable`
 * keeps plugin-wide approval (free iteration), `frozen` keeps only the frozen
 * version approved (updates require a fresh authorization), and `off` persists
 * the definition without running it.
 * @module @deepseek-ai/dsh-cordis-host-runner/library-store
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DynamicCordisLibraryState } from './types.ts'

/** One immutable package version persisted with its source halves. */
export interface LibraryPackageRecord {
  /** Immutable package identity. */
  packageId: string
  /** Package label. */
  name: string
  /** User-facing purpose. */
  purpose: string
  /** Host function body, when the package declares one. */
  hostCode?: string
  /** Client function body, when the package declares one. */
  clientCode?: string
}

/** Lifecycle state of one plugin in the personal library. */
export type LibraryPluginState = DynamicCordisLibraryState

/** One plugin persisted in the personal library. */
export interface LibraryPluginRecord {
  /** Stable plugin identity. */
  pluginId: string
  /** Session that owns this plugin at runtime (real, never synthetic). */
  sessionId: string
  /** Newest package label. */
  name: string
  /** Newest package purpose. */
  purpose: string
  /** Library lifecycle state. */
  state: LibraryPluginState
  /** Last package that completed activation. */
  currentPackageId?: string
  /** Client-bearing packages individually authorized by the user. */
  approvedClientPackages: string[]
  /** Whether one user decision authorized future versions in this state. */
  clientVersionUpdatesApproved: boolean
  /** Versions in define order. */
  packages: LibraryPackageRecord[]
}

/** The durable library document. */
export interface LibraryDocument {
  /** Document format version; bumped only on a breaking layout change. */
  version: 1
  /** Persisted plugins, in save order. */
  plugins: LibraryPluginRecord[]
}

const LIBRARY_DIRECTORY = 'plugins'
const LIBRARY_FILENAME = 'library.json'

/** Absolute path of the library document under one host home. */
/**
 * Derive the absolute library document path under one host home.
 * @param home - host home directory (typically `$DSH_HOME`).
 * @returns the absolute `plugins/library.json` path.
 */
export function libraryPath(home: string): string {
  return join(home, LIBRARY_DIRECTORY, LIBRARY_FILENAME)
}

/** An empty library document. */
/**
 * A fresh, empty library document.
 * @returns an empty document at the current format version.
 */
export function emptyLibrary(): LibraryDocument {
  return { version: 1, plugins: [] }
}

/**
 * Read the library document under one host home. An absent file reads as an
 * empty library; a present but unreadable or malformed document fails loudly
 * so a corrupt library never silently drops the user's plugins.
 * @param home - host home directory (typically `$DSH_HOME`).
 * @returns the persisted document.
 */
export function loadLibrary(home: string): LibraryDocument {
  let raw: string
  try {
    raw = readFileSync(libraryPath(home), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLibrary()
    throw error
  }
  const parsed: unknown = JSON.parse(raw)
  if (!isLibraryDocument(parsed)) {
    throw new Error(`corrupt personal plugin library at ${libraryPath(home)}: unexpected document shape`)
  }
  return parsed
}

/**
 * Persist the library document under one host home, atomically via a
 * same-directory temporary rename so a crash mid-write never leaves a torn
 * document behind.
 * @param home - host home directory (typically `$DSH_HOME`).
 * @param document - the document to persist.
 */
export function saveLibrary(home: string, document: LibraryDocument): void {
  const path = libraryPath(home)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(document, null, 2), 'utf8')
  renameSync(temporary, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isState(value: unknown): value is LibraryPluginState {
  return value === 'off' || value === 'on-editable' || value === 'frozen'
}

function isLibraryPackageRecord(value: unknown): value is LibraryPackageRecord {
  return isRecord(value)
    && isString(value.packageId)
    && isString(value.name)
    && isString(value.purpose)
    && isOptionalString(value.hostCode)
    && isOptionalString(value.clientCode)
}

function isLibraryPluginRecord(value: unknown): value is LibraryPluginRecord {
  return isRecord(value)
    && isString(value.pluginId)
    && isString(value.sessionId)
    && isString(value.name)
    && isString(value.purpose)
    && isState(value.state)
    && isOptionalString(value.currentPackageId)
    && Array.isArray(value.approvedClientPackages)
    && value.approvedClientPackages.every(isString)
    && typeof value.clientVersionUpdatesApproved === 'boolean'
    && Array.isArray(value.packages)
    && value.packages.every(isLibraryPackageRecord)
}

function isLibraryDocument(value: unknown): value is LibraryDocument {
  return isRecord(value)
    && value.version === 1
    && Array.isArray(value.plugins)
    && value.plugins.every(isLibraryPluginRecord)
}

/** Find one persisted plugin by identity, or `undefined` when absent. */
/**
 * Find one persisted plugin by identity.
 * @param document - the library document to search.
 * @param pluginId - stable plugin identity to find.
 * @returns the matching record, or `undefined` when absent.
 */
export function findLibraryPlugin(document: LibraryDocument, pluginId: string): LibraryPluginRecord | undefined {
  return document.plugins.find(plugin => plugin.pluginId === pluginId)
}

/** Insert or replace one persisted plugin, keeping save order for new entries. */
/**
 * Insert or replace one persisted plugin, keeping save order for new entries.
 * @param document - the library document to mutate.
 * @param plugin - the record to insert or replace in place.
 */
export function upsertLibraryPlugin(document: LibraryDocument, plugin: LibraryPluginRecord): void {
  const existing = findLibraryPlugin(document, plugin.pluginId)
  if (existing === undefined) {
    document.plugins.push(plugin)
    return
  }
  document.plugins[document.plugins.indexOf(existing)] = plugin
}

/** Remove one persisted plugin; returns whether it existed. */
/**
 * Remove one persisted plugin.
 * @param document - the library document to mutate.
 * @param pluginId - stable plugin identity to remove.
 * @returns whether a matching record was removed.
 */
export function removeLibraryPlugin(document: LibraryDocument, pluginId: string): boolean {
  const existing = findLibraryPlugin(document, pluginId)
  if (existing === undefined) return false
  document.plugins.splice(document.plugins.indexOf(existing), 1)
  return true
}

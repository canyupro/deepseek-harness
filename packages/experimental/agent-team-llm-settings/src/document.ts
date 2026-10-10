/** Strict decoding of the workspace Agent Teams document. */

import type {
  TeamDocument,
  TeamMemberContext,
  TeamMemberDocument,
  TeamRoleRouteDocument,
  TeamRouteDocument,
} from './types.ts'

/** A teammate name stays lowercase kebab-case so it survives every document round trip. */
export const TEAM_MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The Team Lead's own name; a roster member cannot take it. */
export const LEAD_TEAM_NAME = 'lead'

/** Start mode a member takes when the document omits one. */
export const FRESH_MEMBER_CONTEXT: TeamMemberContext = 'fresh'

/** Field path from the document root, rendered into one rejection message. */
type FieldPath = readonly (string | number)[]

/** A malformed document; the message names the field that rejected it. */
export class TeamDocumentError extends Error {
  override readonly name = 'TeamDocumentError'
}

/** Render one field path relative to the document file. */
function at(path: FieldPath): string {
  return path.reduce<string>((rendered, part) => (
    typeof part === 'number' ? `${rendered}[${part}]` : rendered === '' ? part : `${rendered}.${part}`
  ), '')
}

/** Reject one value, naming the field it was found under. */
function reject(path: FieldPath, message: string): never {
  const field = at(path)
  throw new TeamDocumentError(`team.json${field === '' ? '' : ` ${field}`}: ${message}`)
}

/** Name one rejected value without inlining an unbounded document into the message. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `a ${typeof value}`
}

/**
 * Read one JSON object and reject every field the document format does not declare.
 * @param value - decoded JSON at this field.
 * @param path - field path used in the rejection message.
 * @param allowed - exactly the field names this format declares.
 * @returns the object carrying only declared fields.
 */
function readObject(value: unknown, path: FieldPath, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return reject(path, `expected a JSON object, got ${describe(value)}`)
  }
  const record = value as Record<string, unknown>
  const undeclared = Object.keys(record).filter(key => !allowed.includes(key))
  if (undeclared.length > 0) {
    return reject(path, `unknown field ${undeclared.map(key => `"${key}"`).join(', ')}`)
  }
  return record
}

/** Read one non-empty string field. */
function readString(record: Record<string, unknown>, key: string, path: FieldPath): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    return reject([...path, key], 'must be a non-empty string')
  }
  return value
}

/** Read one free-text field, which may be empty. */
function readText(record: Record<string, unknown>, key: string, path: FieldPath): string {
  const value = record[key]
  if (typeof value !== 'string') return reject([...path, key], `must be a string, got ${describe(value)}`)
  return value
}

/** Read one string field, or undefined when the document omits it. */
function optionalString(record: Record<string, unknown>, key: string, path: FieldPath): string | undefined {
  return key in record ? readString(record, key, path) : undefined
}

/** Read one free-text field, or undefined when the document omits it. */
function optionalText(record: Record<string, unknown>, key: string, path: FieldPath): string | undefined {
  return key in record ? readText(record, key, path) : undefined
}

/** Read one boolean field, or undefined when the document omits it. */
function optionalBoolean(record: Record<string, unknown>, key: string, path: FieldPath): boolean | undefined {
  if (!(key in record)) return undefined
  const value = record[key]
  if (typeof value !== 'boolean') return reject([...path, key], `must be true or false, got ${describe(value)}`)
  return value
}

/** Narrow one value to an array without widening it to `any[]`. */
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/** Read one array field, or undefined when the document omits it. */
function optionalArray(record: Record<string, unknown>, key: string, path: FieldPath): unknown[] | undefined {
  if (!(key in record)) return undefined
  const value = record[key]
  if (!isArray(value)) return reject([...path, key], `must be an array, got ${describe(value)}`)
  return value
}

/** Read one exact route; both halves are required, so a half-written route names its own field. */
function decodeRoute(value: unknown, path: FieldPath): TeamRouteDocument {
  const record = readObject(value, path, ['provider', 'model', 'reasoningEffort'])
  const reasoningEffort = optionalString(record, 'reasoningEffort', path)
  return {
    provider: readString(record, 'provider', path),
    model: readString(record, 'model', path),
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }
}

/** Read one teammate-name preset route. */
function decodeRoleRoute(value: unknown, path: FieldPath): TeamRoleRouteDocument {
  const record = readObject(value, path, ['name', 'provider', 'model', 'reasoningEffort'])
  const reasoningEffort = optionalString(record, 'reasoningEffort', path)
  return {
    name: readString(record, 'name', path),
    provider: readString(record, 'provider', path),
    model: readString(record, 'model', path),
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }
}

/** Read one fixed member, requiring a declared route to give both halves together. */
function decodeMember(value: unknown, path: FieldPath): TeamMemberDocument {
  const record = readObject(value, path, [
    'name', 'description', 'prompt', 'context', 'provider', 'model', 'reasoningEffort', 'sandboxMode',
  ])
  const context = record.context
  if (context !== undefined && context !== 'fresh' && context !== 'fork') {
    return reject([...path, 'context'], 'must be "fresh" or "fork"')
  }
  const sandboxMode = record.sandboxMode
  if (sandboxMode !== undefined
    && sandboxMode !== 'read-only' && sandboxMode !== 'workspace-write' && sandboxMode !== 'danger-full-access') {
    return reject([...path, 'sandboxMode'], 'must be "read-only", "workspace-write", or "danger-full-access"')
  }
  const provider = optionalString(record, 'provider', path)
  const model = optionalString(record, 'model', path)
  if (provider === undefined !== (model === undefined)) {
    return reject(path, provider === undefined
      ? 'names "model" without "provider"'
      : 'names "provider" without "model"')
  }
  const prompt = optionalText(record, 'prompt', path)
  const reasoningEffort = optionalString(record, 'reasoningEffort', path)
  return {
    name: readString(record, 'name', path),
    description: readString(record, 'description', path),
    ...prompt === undefined ? {} : { prompt },
    ...context === undefined ? {} : { context },
    ...sandboxMode === undefined ? {} : { sandboxMode },
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }
}

const DOCUMENT_FIELDS = [
  'version', 'enabled', 'allowedRoutes', 'roleRoutes', 'defaultProvider', 'defaultModel', 'members',
] as const

/**
 * Decode and validate one workspace document.
 *
 * Every rejection names the offending field, and an unknown field rejects
 * rather than being dropped, so a typo in a roster cannot silently do nothing.
 * @param value - decoded JSON read from, or submitted for, the document.
 * @param maxMembers - inclusive deployment cap on roster entries.
 * @returns the validated document.
 * @throws TeamDocumentError when the value is not a valid version-1 document within the cap.
 */
export function parseTeamDocument(value: unknown, maxMembers: number): TeamDocument {
  const root: FieldPath = []
  const record = readObject(value, root, DOCUMENT_FIELDS)
  if (record.version !== 1) {
    reject([...root, 'version'], `must be 1, got ${describe(record.version)}`)
  }
  const defaultProvider = optionalString(record, 'defaultProvider', root)
  const defaultModel = optionalString(record, 'defaultModel', root)
  if (defaultProvider === undefined !== (defaultModel === undefined)) {
    reject(root, defaultProvider === undefined
      ? 'names "defaultModel" without "defaultProvider"'
      : 'names "defaultProvider" without "defaultModel"')
  }
  const allowedRoutes = optionalArray(record, 'allowedRoutes', root)
    ?.map((entry, index) => decodeRoute(entry, [...root, 'allowedRoutes', index]))
  const roleRoutes = optionalArray(record, 'roleRoutes', root)
    ?.map((entry, index) => decodeRoleRoute(entry, [...root, 'roleRoutes', index]))
  const members = optionalArray(record, 'members', root)
    ?.map((entry, index) => decodeMember(entry, [...root, 'members', index]))
  const enabled = optionalBoolean(record, 'enabled', root)
  if (members !== undefined && members.length > maxMembers) {
    reject([...root, 'members'], `holds ${members.length} entries, above the configured maximum of ${maxMembers}`)
  }
  const seen = new Set<string>()
  for (const [index, member] of (members ?? []).entries()) {
    const namePath: FieldPath = [...root, 'members', index, 'name']
    if (!TEAM_MEMBER_NAME.test(member.name)) {
      reject(namePath, `"${member.name}" must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/`)
    }
    if (member.name === LEAD_TEAM_NAME) {
      reject(namePath, `"${LEAD_TEAM_NAME}" is reserved for the Team Lead`)
    }
    if (seen.has(member.name)) {
      reject(namePath, `"${member.name}" repeats an earlier member`)
    }
    seen.add(member.name)
  }
  return {
    version: 1,
    ...enabled === undefined ? {} : { enabled },
    ...allowedRoutes === undefined ? {} : { allowedRoutes },
    ...roleRoutes === undefined ? {} : { roleRoutes },
    ...defaultProvider === undefined ? {} : { defaultProvider },
    ...defaultModel === undefined ? {} : { defaultModel },
    ...members === undefined ? {} : { members },
  }
}

/**
 * The document-scope rules the card applies before a workspace save: which
 * optional fields the project document already carries, and which the draft has
 * moved away from what it inherits.
 *
 * These are pure functions, so each case names the scope it declares and asserts
 * the exact document that leaves — a field the scope omits must be absent from
 * the object, not present and empty.
 */

import { describe, expect, it } from 'vitest'
import {
  agentTeamLlmMemberDrafts, agentTeamLlmTeamDocumentOf, agentTeamLlmTeamMemberOf,
} from '../src/client/team-document.ts'
import type { AgentTeamLlmMemberDraft } from '../src/client/team-document.ts'

/** A staged member row with everything but the route filled. */
function member(overrides: Partial<AgentTeamLlmMemberDraft> = {}): AgentTeamLlmMemberDraft {
  return {
    name: 'recon', description: 'Reads the tree.', prompt: '', context: 'fresh',
    sandboxMode: '', approvalPolicy: '', route: { provider: '', model: '' },
    ...overrides,
  }
}

/** The routing fields every case stages the same way. */
function draft(overrides: Partial<Parameters<typeof agentTeamLlmTeamDocumentOf>[0]> = {}) {
  return {
    enabled: false,
    allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
    roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }],
    defaultProvider: '',
    defaultModel: '',
    members: [member()],
    ...overrides,
  }
}

describe('member drafts keep a stored route effort', () => {
  it('carries a stored effort into the draft and back out', () => {
    const [read] = agentTeamLlmMemberDrafts({
      members: [{ name: 'recon', description: 'Reads.', provider: 'alpha', model: 'fast', reasoningEffort: 'high' }],
    })

    expect(read?.route).toEqual({ provider: 'alpha', model: 'fast', reasoningEffort: 'high' })
    expect(agentTeamLlmTeamMemberOf(read!)).toMatchObject({ reasoningEffort: 'high' })
  })
})

describe('agentTeamLlmTeamDocumentOf', () => {
  it('writes only the fields the scope declares', () => {
    const document = agentTeamLlmTeamDocumentOf(draft(), {
      enabled: false, allowedRoutes: false, roleRoutes: false, members: false,
    })

    expect(document).toEqual({ version: 1 })
  })

  it('writes every declared field', () => {
    const document = agentTeamLlmTeamDocumentOf(
      draft({ enabled: true, defaultProvider: 'alpha', defaultModel: 'fast' }),
      { enabled: true, allowedRoutes: true, roleRoutes: true, members: true },
    )

    expect(document).toEqual({
      version: 1,
      enabled: true,
      allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
      roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }],
      defaultProvider: 'alpha',
      defaultModel: 'fast',
      members: [{ name: 'recon', description: 'Reads the tree.', context: 'fresh' }],
    })
  })

  it('omits the default route as a whole unless both halves are set', () => {
    const providerOnly = agentTeamLlmTeamDocumentOf(
      draft({ defaultProvider: 'alpha', defaultModel: '' }),
      { enabled: false, allowedRoutes: false, roleRoutes: false, members: false },
    )
    // A present-but-empty field is read back as a non-string by the Host.
    expect(providerOnly).not.toHaveProperty('defaultProvider')
    expect(providerOnly).not.toHaveProperty('defaultModel')

    const complete = agentTeamLlmTeamDocumentOf(
      draft({ defaultProvider: 'alpha', defaultModel: 'fast' }),
      { enabled: false, allowedRoutes: false, roleRoutes: false, members: false },
    )
    expect(complete).toMatchObject({ defaultProvider: 'alpha', defaultModel: 'fast' })
  })

  it('writes a declared member roster with its stored fields', () => {
    const document = agentTeamLlmTeamDocumentOf(
      draft({
        members: [member({
          prompt: 'Read first.', context: 'fork', sandboxMode: 'read-only',
          route: { provider: 'alpha', model: 'fast', reasoningEffort: 'high' },
        })],
      }),
      { enabled: false, allowedRoutes: false, roleRoutes: false, members: true },
    )

    expect(document.members).toEqual([{
      name: 'recon',
      description: 'Reads the tree.',
      prompt: 'Read first.',
      context: 'fork',
      sandboxMode: 'read-only',
      provider: 'alpha',
      model: 'fast',
      reasoningEffort: 'high',
    }])
  })
})

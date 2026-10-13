/** Host option resolution for the origins allowed to open the Client ingest socket. */

import { describe, expect, it } from 'vitest'
import { resolveInspectorOptions } from '../src/host/bridge/controller.ts'

describe('resolveInspectorOptions client origins', () => {
  it('accepts the desktop shell scheme, whose origin serializes as null', () => {
    // `dsh-app:` is not a special scheme: `new URL('dsh-app://app').origin` is
    // the literal `null`, so an equality check on `origin` rejected the very
    // value the desktop profile must configure to pass the ingest handshake.
    expect(new URL('dsh-app://app').origin).toBe('null')
    expect(resolveInspectorOptions({ clientOrigins: ['dsh-app://app'] }).clientOrigins)
      .toEqual(['dsh-app://app'])
  })

  it('keeps accepting special-scheme origins and rejects non-canonical values', () => {
    expect(resolveInspectorOptions({ clientOrigins: ['http://127.0.0.1:9230'] }).clientOrigins)
      .toEqual(['http://127.0.0.1:9230'])
    expect(() => resolveInspectorOptions({ clientOrigins: ['http://127.0.0.1:9230/'] }))
      .toThrow('inspector: client origin must be canonical: http://127.0.0.1:9230/')
    expect(() => resolveInspectorOptions({ clientOrigins: ['dsh-app://app/'] }))
      .toThrow('inspector: client origin must be canonical: dsh-app://app/')
    expect(() => resolveInspectorOptions({ clientOrigins: ['not a url'] })).toThrow()
  })
})

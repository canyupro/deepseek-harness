/**
 * The CSS Modules class-name guard, in the one place the fallback now lives.
 *
 * Under `noUncheckedIndexedAccess` a `*.module.css` lookup is `string | undefined`,
 * so every call site needs the empty-string fallback; asserting it here is what
 * keeps that contract from drifting back into ten separate branches.
 */

import { describe, expect, it } from 'vitest'
import { classNameOf } from '../src/client/class-name.ts'

describe('classNameOf', () => {
  it('passes a declared class name through unchanged', () => {
    expect(classNameOf('row')).toBe('row')
    expect(classNameOf('itemLabel')).toBe('itemLabel')
  })

  it('renders an absent key as the empty string', () => {
    // An undefined class would reach React as the string "undefined".
    expect(classNameOf(undefined)).toBe('')
  })
})

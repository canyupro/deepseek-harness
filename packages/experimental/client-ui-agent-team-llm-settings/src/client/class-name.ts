/**
 * CSS Modules class-name guard.
 *
 * The shared `*.module.css` declaration types every lookup as
 * `string | undefined` under `noUncheckedIndexedAccess`, while `className`
 * accepts only a string under `exactOptionalPropertyTypes`. One helper keeps
 * that fallback in a single testable place instead of repeating the branch at
 * every call site.
 * @param value - a CSS Modules class name, or `undefined` for an absent key.
 * @returns the class name, or the empty string when the module declares none.
 */
export function classNameOf(value: string | undefined): string {
  return value ?? ''
}

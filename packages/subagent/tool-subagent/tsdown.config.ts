import { defineConfig } from 'tsdown'

const entry = (path: string) => ({
  entry: [path],
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024' as const,
  fixedExtension: false,
  dts: false,
  clean: false,
})

/** Build self-contained Loader entries so the package needs no private chunks. */
export default defineConfig([
  entry('lib/types/index.js'),
  // The exported child-route helpers are their own bundle: the Agent Teams tool
  // imports the subpath, which must not pull in this package's Loader entry.
  entry('lib/types/model-selection.js'),
  entry('lib/types/model-selection-settings.js'),
])

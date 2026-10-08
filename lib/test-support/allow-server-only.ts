/**
 * Test-only. Import first, before any module that starts with `import "server-only"`,
 * so plain `npx tsx` (no react-server condition) can load it. Never import from app code.
 */
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
} as NodeJS.Module;

export {};

// Bundles the Functions app into a single CommonJS file so the deployment package
// needs no node_modules (and workspace packages like @woutist/contracts are inlined).
import { build } from 'esbuild'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  // Provided by the Functions Node.js worker at runtime.
  external: ['@azure/functions-core'],
  logLevel: 'info',
})

// Self-contained deployment folder: host.json + package.json + dist/
await rm('deploy', { recursive: true, force: true })
await mkdir('deploy', { recursive: true })
await cp('dist', 'deploy/dist', { recursive: true })
await cp('host.json', 'deploy/host.json')
await writeFile(
  'deploy/package.json',
  JSON.stringify({ name: 'woutist-api', version: '0.1.0', main: 'dist/index.js' }, null, 2),
)

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8')

test('build prepares Python in the final resource directory without a Windows directory rename', () => {
  assert.match(build, /const finalBackend = path\.join\(buildRoot, 'backend'\)/)
  assert.match(build, /const runtime = path\.join\(finalBackend, 'runtime'\)/)
  assert.match(build, /path\.join\(finalBackend, 'requirements\.txt'\)/)
  assert.match(build, /path\.join\(finalBackend, 'manifest\.json'\)/)
  assert.match(build, /path\.relative\(finalBackend, python\)/)
  assert.doesNotMatch(build, /backend-staging|fs\.renameSync\(/)
})

test('clean with bounded retry and validate before Electron packaging', () => {
  const cleanup = build.indexOf('fs.rmSync(finalBackend, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })')
  const prepare = build.indexOf('const { python, source } = preparePythonRuntime()')
  const manifest = build.indexOf("fs.writeFileSync(path.join(finalBackend, 'manifest.json')")
  const validation = build.indexOf("run(process.execPath, ['scripts/verify-runtime.mjs', finalBackend])")
  const packageStep = build.indexOf("run(packageManager, [...prefix, 'electron-builder'")
  assert.ok(cleanup >= 0 && cleanup < prepare && prepare < manifest && manifest < validation && validation < packageStep)
  assert.match(build, /path\.join\(root, 'dist', 'win-unpacked', 'resources', 'backend'\)/)
})

test('offline managed Python lookup explicitly excludes active virtual environments', () => {
  assert.match(build, /\['python', 'find', '--system', '--managed-python', '--no-project', '--no-python-downloads', pythonVersion\]/)
  assert.match(build, /env: basePythonEnvironment\(\)/)
})

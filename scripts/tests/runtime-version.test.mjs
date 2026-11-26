import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseRuntimeVersion } from '../lib/runtime-version.mjs'

test('runtime DLL matches the configured CPython major and minor', () => {
  for (const minor of [10, 11, 12, 13, 14, 15]) {
    for (const version of [`3.${minor}`, `3.${minor}.2`]) {
      assert.deepEqual(parseRuntimeVersion(version), {
        requested: version,
        dll: `python3${minor}.dll`,
      })
    }
  }
})

test('invalid and unsupported manifest versions cannot bypass runtime validation', () => {
  for (const value of [undefined, null, 3.12, '', '3.9', '3.13t', '3.14-debug',
    '3.12.1.2', '3.12/../python313.dll', '3.12\n']) {
    assert.throws(() => parseRuntimeVersion(value), /Invalid bundled Python version/)
  }
})

test('runtime validator uses the manifest DLL and checks the real interpreter version', () => {
  const source = readFileSync(new URL('../verify-runtime.mjs', import.meta.url), 'utf8')
  assert.match(source, /parseRuntimeVersion\(manifest\.python_version\)/)
  assert.match(source, /path\.join\(runtime, version\.dll\)/)
  assert.match(source, /actual = tuple\(sys\.version_info\[:len\(expected\)\]\)/)
  assert.match(source, /assert actual == expected/)
  assert.match(source, /\['-I', '-c', verification, version\.requested\]/)
  assert.doesNotMatch(source, /['"]python312\.dll['"]/)
})

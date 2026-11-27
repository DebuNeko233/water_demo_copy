import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { containedRelative, ensureRuntimeDll, basePythonEnvironment } from '../lib/runtime-copy.mjs'

test('restore a missing or truncated DLL in its actual relative directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-runtime-'))
  try {
    const root = path.join(tmp, 'source')
    const target = path.join(tmp, 'target')
    const rel = path.join('DLLs','python312.dll')
    const dll = path.join(root, rel)
    fs.mkdirSync(path.dirname(dll), {recursive:true})
    fs.writeFileSync(dll, 'original-runtime-dll')
    const info = {dll, dllRelative:containedRelative(root,dll)}
    const copied = ensureRuntimeDll(info, target, 'test')
    assert.equal(copied, path.join(target,rel))
    assert.equal(fs.readFileSync(copied,'utf8'), 'original-runtime-dll')
    fs.writeFileSync(copied, 'short')
    ensureRuntimeDll(info, target, 'after pip')
    assert.equal(fs.readFileSync(copied,'utf8'), 'original-runtime-dll')
    assert.throws(()=>containedRelative(root,path.join(tmp,'external.dll')), /outside/)
    fs.unlinkSync(dll)
    assert.throws(()=>ensureRuntimeDll(info,target,'missing source'), /source DLL disappeared/)
  } finally {
    fs.rmSync(tmp,{recursive:true,force:true})
  }
})

test('base Python discovery ignores activated environment variables but preserves uv cache configuration', () => {
  const input = {Virtual_Env:'dev', PYTHONHOME:'other', PYTHONPATH:'modules',
    UV_PROJECT_ENVIRONMENT:'venv', CONDA_PREFIX:'conda', CONDA_DEFAULT_ENV:'name',
    __PYVENV_LAUNCHER__:'launcher', PATH:'original-path', UV_PYTHON_INSTALL_DIR:'custom-cache',
    UV_CACHE_DIR:'wheel-cache'}
  assert.deepEqual(basePythonEnvironment(input), {PATH:'original-path',
    UV_PYTHON_INSTALL_DIR:'custom-cache', UV_CACHE_DIR:'wheel-cache'})
  assert.equal(input.Virtual_Env, 'dev')
})

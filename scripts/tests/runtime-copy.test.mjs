import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { containedRelative, ensureRuntimeDll } from '../lib/runtime-copy.mjs'

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

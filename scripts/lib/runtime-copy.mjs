/** Inspect the real CPython installation, not a uv launcher or guessed DLL path. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseRuntimeVersion } from './runtime-version.mjs'

export const loadedDllPython = `
import ctypes, sys
from ctypes import wintypes
def loaded_python_dll():
    get_name = ctypes.WinDLL('kernel32', use_last_error=True).GetModuleFileNameW
    get_name.argtypes = (wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD)
    get_name.restype = wintypes.DWORD
    buf = ctypes.create_unicode_buffer(32768)
    length = get_name(sys.dllhandle, buf, len(buf))
    if not length or length >= len(buf):
        raise RuntimeError('Cannot resolve loaded CPython DLL')
    return buf.value
`

export function containedRelative(root, filename) {
  const relative = path.relative(root, filename)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Python runtime file is outside its installation: ' + filename)
  }
  return relative
}

// Only isolate interpreter discovery/probing; preserve uv cache/install-directory settings.
export function basePythonEnvironment(environment = process.env) {
  const excluded = new Set(['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV',
    'UV_PROJECT_ENVIRONMENT', 'CONDA_PREFIX', 'CONDA_DEFAULT_ENV', '__PYVENV_LAUNCHER__'])
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !excluded.has(key.toUpperCase())))
}

export function inspectManagedRuntime(executable, requested) {
  const expected = parseRuntimeVersion(requested)
  const env = basePythonEnvironment()
  const code = loadedDllPython + `
import json, pathlib
print(json.dumps({
    'root': str(pathlib.Path(sys.base_prefix).resolve()),
    'dll': str(pathlib.Path(loaded_python_dll()).resolve()),
    'version': '.'.join(map(str, sys.version_info[:3])),
    'prefix': str(pathlib.Path(sys.prefix).resolve()),
}))
`
  const result = spawnSync(executable, ['-I', '-c', code], {
    env, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    throw new Error('Cannot inspect uv-managed Python: ' + executable + '\n' +
      (result.error?.message ?? result.stderr ?? ''))
  }
  const info = JSON.parse(result.stdout.trim())
  if (!(info.version === requested || info.version.startsWith(requested + '.'))) {
    throw new Error('Managed Python version mismatch: requested ' + requested + ', actual ' + info.version)
  }
  const root = fs.realpathSync(info.root)
  const prefix = fs.realpathSync(info.prefix)
  if (path.relative(root, prefix) !== '') {
    throw new Error('uv returned a virtual environment, not base Python' +
      '\nInterpreter: ' + executable + '\nsys.prefix: ' + prefix + '\nsys.base_prefix: ' + root)
  }
  const dll = fs.realpathSync(info.dll)
  if (path.basename(dll).toLowerCase() !== expected.dll) {
    throw new Error('Unexpected loaded CPython DLL: ' + dll)
  }
  const dllRelative = containedRelative(root, dll)
  const baseExecutable = path.join(root, 'python.exe')
  for (const file of [baseExecutable, dll, path.join(root, 'Lib','encodings','__init__.py')]) {
    if (!fs.statSync(file, {throwIfNoEntry:false})?.isFile()) {
      throw new Error('Incomplete uv-managed Python installation: ' + file)
    }
  }
  return { root, dll, dllRelative, version: info.version }
}

/** A runtime DLL is not a pip dependency. Restore only the exact file from the
 * verified interpreter if package installation or copying removed it. */
export function ensureRuntimeDll(source, targetRoot, stage) {
  const target = path.join(targetRoot, source.dllRelative)
  if (!fs.statSync(source.dll, {throwIfNoEntry:false})?.isFile()) {
    throw new Error('Verified source DLL disappeared: ' + source.dll)
  }
  const sourceSize = fs.statSync(source.dll).size
  const copied = fs.statSync(target, {throwIfNoEntry:false})
  if (!copied?.isFile() || copied.size !== sourceSize) {
    console.warn('[build] Restoring CPython DLL (' + stage + '): ' + source.dll + ' -> ' + target)
    fs.mkdirSync(path.dirname(target), {recursive:true})
    fs.copyFileSync(source.dll, target)
  }
  if (!fs.statSync(target, {throwIfNoEntry:false})?.isFile() || fs.statSync(target).size !== sourceSize) {
    throw new Error('CPython DLL copy failed (' + stage + '): ' + target)
  }
  console.log('[build] CPython DLL verified (' + stage + '): ' + target)
  return target
}

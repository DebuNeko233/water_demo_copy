/**
 * Windows 绿色构建总入口：组装独立 CPython + 正式依赖，再编译 Electron。
 * 不复制开发 .venv，用户只需完整的 win-unpacked 目录。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProcessCommand } from './lib/process-command.mjs'
import { ensureUv } from './uv-bootstrap.mjs'
import { ensureElectron } from './ensure-electron.mjs'
import { inspectManagedRuntime, ensureRuntimeDll, basePythonEnvironment } from './lib/runtime-copy.mjs'

// 以脚本自身定位仓库根目录，不受调用它的终端当前目录影响。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backend = path.join(root, 'backend')
const buildRoot = path.join(root, 'build')
// 直接组装 electron-builder 使用的资源目录。Windows 可能在 Python 退出后
// 短暂锁定 DLL，避免再对整个运行时目录执行 rename。
const finalBackend = path.join(buildRoot, 'backend')
const runtime = path.join(finalBackend, 'runtime')
const pythonVersion = fs.readFileSync(path.join(backend, '.python-version'), 'utf8').trim()
// uv 可以来自系统 PATH，也可以来自本地自动引导的 .tools/ 缓存。
let uv

function run(command, args, options = {}) {
  console.log('[build]', command, ...args)
  // Windows 的 pnpm/npm 是 .cmd 启动器，需要特别处理；uv/Python 直接执行。
  const processCommand = resolveProcessCommand(command === 'uv' ? uv : command, args)
  const result = spawnSync(processCommand.command, processCommand.args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  })
  // 任一步骤失败即中断，防止把不完整的环境当成构建成功。
  if (result.error || result.status !== 0) {
    throw new Error(command + ' failed: ' + (result.error?.message ?? result.status))
  }
}

/**
 * Locate the Python version uv already installed on this computer.
 * This lookup is offline and ignores the project's disposable .venv.
 */
function findManagedPython() {
  const result = spawnSync(
    uv,
    // --no-project 并不排除已激活或当前目录的虚拟环境；必须同时使用 --system。
    ['python', 'find', '--system', '--managed-python', '--no-project', '--no-python-downloads', pythonVersion],
    { cwd: root, env: basePythonEnvironment(), encoding: 'utf8', shell: false },
  )
  if (result.error) throw new Error('uv is required: ' + result.error.message)
  if (result.status !== 0) return null

  const executable = fs.realpathSync(result.stdout.trim())
  if (path.basename(executable).toLowerCase() !== 'python.exe') {
    throw new Error('uv returned an unexpected Python executable: ' + executable)
  }
  return executable
}

/**
 * Install into uv's persistent user-level Python directory only once.
 * Copy the interpreter from there into build/, so installing dependencies
 * for the release cannot modify the cached original.
 */
function preparePythonRuntime() {
  let sourcePython = findManagedPython()
  if (!sourcePython) {
    console.log('[build] Python ' + pythonVersion + ' is not cached; installing it once with uv.')
    run('uv', ['python', 'install', pythonVersion])
    sourcePython = findManagedPython()
  }
  if (!sourcePython) throw new Error('uv could not find Python ' + pythonVersion)

  console.log('[build] uv selected Python:', sourcePython)
  const source = inspectManagedRuntime(sourcePython, pythonVersion)
  console.log('[build] Reusing local Python:', source.root)
  console.log('[build] Actual CPython DLL:', source.dll)
  // 从解释器真实的 base_prefix 复制，而不是从可能为启动器的路径猜测。
  fs.cpSync(source.root, runtime, {
    recursive: true,
    dereference: true,
    force: true,
  })

  const packagedPython = path.join(runtime, 'python.exe')
  if (!fs.existsSync(packagedPython)) {
    throw new Error('The copied Python runtime has no python.exe')
  }
  ensureRuntimeDll(source, runtime, 'initial copy')
  return { python: packagedPython, source }
}

if (process.platform !== 'win32') {
  throw new Error('The initial release builder targets Windows x64. Build on Windows.')
}

// 正式运行时使用独立副本，避免依赖和开发机 uv 缓存之间的硬链接。
const env = { ...process.env, UV_LINK_MODE: 'copy' }

try {
  // Electron 42+ no longer downloads itself at pnpm install time.
  ensureElectron()
  uv = await ensureUv()
  // Resolve using pyproject.toml; uv may create an ignored, local uv.lock.
  // Keep the project .venv separate from the self-contained release runtime.
  run('uv', ['sync', '--project', backend])
  // 仅清理生成目录；短暂的 Windows 文件占用由 Node 的有限重试处理。
  // 删除失败立即中止，绝不将新运行时覆盖到旧的半完整目录。
  fs.mkdirSync(buildRoot, { recursive: true })
  fs.rmSync(finalBackend, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  fs.mkdirSync(finalBackend, { recursive: true })
  const { python, source } = preparePythonRuntime()

  const requirements = path.join(finalBackend, 'requirements.txt')
  // 导出生产依赖但不导出 pytest 等开发依赖；业务包稍后单独安装。
  run('uv', [
    'export', '--project', backend, '--no-dev',
    '--no-emit-project', '--format', 'requirements-txt', '--output-file', requirements,
  ])
  // This interpreter is a fresh, project-owned copy inside build/, never a system Python.
  // uv marks managed CPython externally managed, so explicit permission is required here.
  run('uv', ['pip', 'sync', '--python', python, '--system', '--break-system-packages', requirements], { env })
  // 第三方依赖已同步，这一步只安装自己的 sample_backend 包。
  run('uv', ['pip', 'install', '--python', python, '--system', '--break-system-packages', '--no-deps', backend], { env })
  ensureRuntimeDll(source, runtime, 'after dependency install')
  // 隔离模式验证发行环境可以独立导入，避免开发机路径掩盖缺包问题。
  run(python, ['-I', '-c', 'import fastapi, uvicorn, loguru, sample_backend; print("Backend import passed")'])

  // The packaged manifest points only to the self-contained release copy.
  const relativePython = path.relative(finalBackend, python).replaceAll('\\', '/')
  fs.writeFileSync(path.join(finalBackend, 'manifest.json'), JSON.stringify({
    python: relativePython,
    python_version: pythonVersion,
    python_dll: path.relative(finalBackend, path.join(runtime, source.dllRelative)).replaceAll('\\', '/'),
    backend_package: 'sample_backend',
  }, null, 2) + '\n')

  // 不移动已执行过的 Python 目录，避免 Windows EPERM。
  ensureRuntimeDll(source, runtime, 'final backend')
  // Before Electron copies resources, validate all interpreter components,
  // native dependencies and real MP4/AVI decoding in an isolated process.
  run(process.execPath, ['scripts/verify-runtime.mjs', finalBackend])
  // pnpm/npm 的 exec 参数略有不同；统一执行类型检查、前端编译和打包。
  const isPnpm = (process.env.npm_config_user_agent ?? '').startsWith('pnpm/')
  const packageManager = isPnpm ? 'pnpm' : 'npm'
  const prefix = isPnpm ? ['exec'] : ['exec', '--']
  run(packageManager, ['run', 'typecheck'])
  run(packageManager, [...prefix, 'electron-vite', 'build'])
  // Never allow previous dist contents to make an incomplete new build look
  // complete. The only supported release is the entire win-unpacked folder.
  fs.rmSync(path.join(root, 'dist', 'win-unpacked'), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  run(packageManager, [...prefix, 'electron-builder', '--win', '--dir', '--x64'])
  // Verify the actual files copied into the published Windows folder, not
  // only the prepared build/backend resource directory.
  run(process.execPath, ['scripts/verify-runtime.mjs',
    path.join(root, 'dist', 'win-unpacked', 'resources', 'backend')])
  console.log('Portable Windows directory: dist/win-unpacked')
} catch (error) {
  console.error('[build] Failed:', error)
  process.exitCode = 1
}

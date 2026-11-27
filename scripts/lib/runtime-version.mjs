/** The standard Windows CPython ABI DLL follows the major/minor version.
 * Accept the same ordinary version pins as python:use (including patch pins).
 * Free-threaded/debug variants are intentionally not accepted by this builder.
 */
export function parseRuntimeVersion(value) {
  if (typeof value !== 'string' || !/^3\.(10|11|12|13|14|15)(?:\.\d+)?$/.test(value)) {
    throw new Error('Invalid bundled Python version in manifest: ' + String(value))
  }
  const [major, minor] = value.split('.')
  return { requested: value, dll: `python${major}${minor}.dll` }
}

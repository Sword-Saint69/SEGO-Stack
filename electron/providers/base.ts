import { spawn } from 'child_process'

export type ProviderId = 'winget' | 'choco' | 'scoop'

export interface ProviderResult {
  success: boolean
  output: string
  provider: ProviderId
}

// Allow only safe package IDs - prevents command injection
const SAFE_ID_REGEX = /^[a-zA-Z0-9._\-]+$/

export function isSafePackageId(id: string): boolean {
  return SAFE_ID_REGEX.test(id) && id.length > 0 && id.length < 128
}

export function runCommand(
  cmd: string,
  args: string[],
  timeoutMs = 120000
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      windowsHide: true,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
      reject(new Error(`Command timed out: ${cmd} ${args.join(' ')}`))
    }, timeoutMs)

    proc.stdout?.on('data', (d) => (stdout += d.toString()))
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    proc.on('error', (err) => {
      clearTimeout(timer)
      if (!timedOut) reject(err)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (!timedOut) resolve({ stdout, stderr, code })
    })
  })
}

export abstract class BaseProvider {
  abstract readonly id: ProviderId
  abstract readonly executable: string

  async isAvailable(): Promise<{ available: boolean; version?: string }> {
    try {
      const result = await runCommand(this.executable, this.versionArgs(), 8000)
      if (result.code === 0) {
        return { available: true, version: result.stdout.trim().split('\n')[0].slice(0, 120) }
      }
      return { available: false }
    } catch {
      return { available: false }
    }
  }

  abstract versionArgs(): string[]
  abstract listInstalledArgs(): string[] // not used directly - isInstalled uses specific check
  abstract isInstalled(packageId: string): Promise<boolean>
  abstract install(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult>
  abstract uninstall(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult>

  protected validateId(packageId: string) {
    if (!isSafePackageId(packageId)) {
      throw new Error(`Unsafe package ID: ${packageId}`)
    }
  }
}

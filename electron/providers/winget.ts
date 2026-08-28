import { BaseProvider, runCommand, ProviderResult } from './base.js'
import { spawn } from 'child_process'

export class WingetProvider extends BaseProvider {
  readonly id = 'winget' as const
  readonly executable = 'winget'

  versionArgs(): string[] {
    return ['--version']
  }

  listInstalledArgs(): string[] {
    return ['list']
  }

  async isInstalled(packageId: string): Promise<boolean> {
    this.validateId(packageId)
    try {
      // winget list --id <id> --exact
      const result = await runCommand(this.executable, ['list', '--id', packageId, '--exact', '--accept-source-agreements'], 15000)
      // winget returns 0 even if not found but output contains "No installed package found"
      const out = result.stdout + result.stderr
      if (out.toLowerCase().includes('no installed package found') || out.toLowerCase().includes('no package found')) {
        return false
      }
      // If packageId appears in output and exit 0, assume installed
      return out.toLowerCase().includes(packageId.toLowerCase().split('.')[0].toLowerCase()) && result.code === 0
        ? true
        : false
    } catch {
      return false
    }
  }

  async install(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult> {
    this.validateId(packageId)
    return this.spawnWinget(['install', '--id', packageId, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements'], onOutput)
  }

  async uninstall(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult> {
    this.validateId(packageId)
    return this.spawnWinget(['uninstall', '--id', packageId, '--exact', '--silent', '--accept-source-agreements'], onOutput)
  }

  private spawnWinget(args: string[], onOutput: (data: string) => void): Promise<ProviderResult> {
    return new Promise((resolve) => {
      const proc = spawn(this.executable, args, { windowsHide: true, shell: false })
      let output = ''
      const handle = (data: Buffer) => {
        const text = data.toString()
        output += text
        onOutput(text)
      }
      proc.stdout?.on('data', handle)
      proc.stderr?.on('data', handle)
      proc.on('error', (err) => {
        resolve({ success: false, output: output + '\n' + err.message, provider: this.id })
      })
      proc.on('close', (code) => {
        resolve({ success: code === 0, output, provider: this.id })
      })
    })
  }
}

import { BaseProvider, runCommand, ProviderResult } from './base.js'
import { spawn } from 'child_process'

export class ChocoProvider extends BaseProvider {
  readonly id = 'choco' as const
  readonly executable = 'choco'

  versionArgs(): string[] {
    return ['--version']
  }

  listInstalledArgs(): string[] {
    return ['list', '--local-only']
  }

  async isInstalled(packageId: string): Promise<boolean> {
    this.validateId(packageId)
    try {
      const result = await runCommand(this.executable, ['list', '--local-only', '--exact', packageId], 15000)
      const out = result.stdout.toLowerCase()
      // choco list returns "1 packages installed." header + line "packagename version"
      // If only 0 or 1 and no exact match, check
      return out.includes(packageId.toLowerCase()) && !out.includes('0 packages installed')
    } catch {
      return false
    }
  }

  async install(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult> {
    this.validateId(packageId)
    return this.spawnChoco(['install', packageId, '-y', '--no-progress'], onOutput)
  }

  async uninstall(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult> {
    this.validateId(packageId)
    return this.spawnChoco(['uninstall', packageId, '-y'], onOutput)
  }

  private spawnChoco(args: string[], onOutput: (data: string) => void): Promise<ProviderResult> {
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

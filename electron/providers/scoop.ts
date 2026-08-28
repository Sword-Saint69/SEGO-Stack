import { BaseProvider, runCommand, ProviderResult } from './base.js'
import { spawn } from 'child_process'

export class ScoopProvider extends BaseProvider {
  readonly id = 'scoop' as const
  readonly executable = 'scoop'

  versionArgs(): string[] {
    return ['--version']
  }

  listInstalledArgs(): string[] {
    return ['list']
  }

  async isInstalled(packageId: string): Promise<boolean> {
    this.validateId(packageId)
    try {
      const result = await runCommand(this.executable, ['list'], 10000)
      return result.stdout.toLowerCase().includes(packageId.toLowerCase())
    } catch {
      return false
    }
  }

  async install(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult> {
    this.validateId(packageId)
    return this.spawnScoop(['install', packageId], onOutput)
  }

  async uninstall(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult> {
    this.validateId(packageId)
    return this.spawnScoop(['uninstall', packageId], onOutput)
  }

  private spawnScoop(args: string[], onOutput: (data: string) => void): Promise<ProviderResult> {
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

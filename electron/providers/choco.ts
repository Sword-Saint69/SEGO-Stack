import { BaseProvider, runCommand, ProviderResult } from './base.js'
import { spawn } from 'child_process'

export class ChocoProvider extends BaseProvider {
  readonly id = 'choco' as const
  readonly executable = 'choco'

  versionArgs(): string[] {
    return ['--version']
  }

  listInstalledArgs(): string[] {
    return ['list']
  }

  async isInstalled(packageId: string): Promise<boolean> {
    this.validateId(packageId)
    try {
      const result = await runCommand(this.executable, ['list', packageId, '--exact', '--limit-output'], 15000)
      const out = result.stdout.toLowerCase().trim()
      const err = result.stderr.toLowerCase()
      if (err.includes('0 packages installed') || out.includes('0 packages installed')) return false
      if (result.code !== 0) return false
      // choco --limit-output format: "packagename|version"
      const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
      const idLower = packageId.toLowerCase()
      return lines.some(line => {
        const [name] = line.split('|')
        return name.trim() === idLower
      })
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

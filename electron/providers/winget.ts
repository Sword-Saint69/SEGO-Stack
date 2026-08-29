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
      // Strict check: winget list --id <id> --exact should return a table with the exact Id
      const result = await runCommand(this.executable, ['list', '--id', packageId, '--exact', '--accept-source-agreements'], 15000)
      const out = result.stdout + result.stderr
      const low = out.toLowerCase()
      if (low.includes('no installed package found') || low.includes('no package found') || low.includes('no package found matching input criteria')) {
        return false
      }
      if (result.code !== 0) return false
      // Strict: output must contain the full packageId as a standalone token (not just prefix)
      // winget table format: Name ... Id ... Version ... — check for exact Id
      const idLower = packageId.toLowerCase()
      const lines = out.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean)
      // Find a line that contains the exact Id and a version pattern (e.g. 1.0.9255)
      const hasExact = lines.some(line => {
        if (!line.includes(idLower)) return false
        // Ensure Id appears as whole word — check with word boundaries via split
        const tokens = line.split(/\s+/)
        const hasIdToken = tokens.some(t => t === idLower)
        // Also accept if line contains Id and has a version-like token (digit.digit)
        const hasVersion = /\d+\.\d+/.test(line)
        return hasIdToken || (line.includes(idLower) && hasVersion)
      })
      return hasExact
    } catch {
      return false
    }
  }

  async install(packageId: string, onOutput: (data: string) => void): Promise<ProviderResult> {
    this.validateId(packageId)
    // For GUI installers with Next prompts (Discord Squirrel, etc.) we want interactive auto-start,
    // not silent which can fail on file locks. Use --interactive for known GUI, otherwise --silent
    // Known GUI Squirrel/Inno with Next: Discord, etc. — use interactive so installer UI shows
    const guiInteractiveIds = new Set([
      'Discord.Discord',
      'VideoLAN.VLC',
      'Notepad++.Notepad++',
      'Valve.Steam',
      'OBSProject.OBSStudio',
      'Zoom.Zoom',
      'SlackTechnologies.Slack'
    ])
    const useInteractive = guiInteractiveIds.has(packageId)
    const modeFlag = useInteractive ? '--interactive' : '--silent'
    return this.spawnWinget(['install', '--id', packageId, '--exact', modeFlag, '--accept-package-agreements', '--accept-source-agreements'], onOutput)
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

import { BaseProvider, ProviderId } from './base.js'
import { WingetProvider } from './winget.js'
import { ChocoProvider } from './choco.js'
import { ScoopProvider } from './scoop.js'

interface CatalogApp {
  id: string
  name: string
  providers: Record<string, string>
}

export class ProviderRouter {
  providers: Record<ProviderId, BaseProvider>

  constructor() {
    this.providers = {
      winget: new WingetProvider(),
      choco: new ChocoProvider(),
      scoop: new ScoopProvider()
    }
  }

  // Windows priority: winget > choco > scoop
  getPriorityOrder(): ProviderId[] {
    return ['winget', 'choco', 'scoop']
  }

  async getAvailableProviders(): Promise<{ id: ProviderId; available: boolean; version?: string }[]> {
    const results = await Promise.all(
      this.getPriorityOrder().map(async (id) => {
        const p = this.providers[id]
        const status = await p.isAvailable()
        return { id, ...status }
      })
    )
    return results
  }

  // Pick best available provider for an app
  async resolveProvider(app: CatalogApp): Promise<{ provider: BaseProvider; packageId: string } | null> {
    const available = await this.getAvailableProviders()
    const availableSet = new Set(available.filter((p) => p.available).map((p) => p.id))

    for (const pid of this.getPriorityOrder()) {
      if (availableSet.has(pid) && app.providers[pid]) {
        return { provider: this.providers[pid], packageId: app.providers[pid]! }
      }
    }
    return null
  }

  // For isInstalled check - try providers in order until one says installed or we exhaust
  async isAppInstalled(app: CatalogApp): Promise<boolean> {
    for (const pid of this.getPriorityOrder()) {
      const pkgId = app.providers[pid]
      if (!pkgId) continue
      const provider = this.providers[pid]
      const avail = await provider.isAvailable()
      if (!avail.available) continue
      try {
        if (await provider.isInstalled(pkgId)) return true
      } catch {
        // ignore
      }
    }
    return false
  }
}

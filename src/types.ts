export interface CatalogApp {
  id: string
  name: string
  description: string
  category: string
  icon: string
  providers: {
    winget?: string
    choco?: string
    scoop?: string
  }
}

export type ProviderId = 'winget' | 'choco' | 'scoop'

export interface ProviderStatus {
  id: ProviderId
  available: boolean
  version?: string
}

export type InstallStatus = 'idle' | 'queued' | 'installing' | 'success' | 'failed' | 'skipped'

export interface InstallProgress {
  appId: string
  status: InstallStatus
  provider?: ProviderId
  message?: string
  output?: string
}

export interface AppState extends CatalogApp {
  selected: boolean
  installed: boolean | null // null = checking
  installStatus: InstallStatus
  installMessage?: string
}

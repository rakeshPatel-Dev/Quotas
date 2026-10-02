import { create } from 'zustand'
import { groupIntoPools, hasQuotaData, isLowQuota, type QuotaPool } from '../shared/pools'
import type { PublicAccount } from '../shared/types'

declare global {
  interface Window {
    quota: {
      listAccounts(): Promise<PublicAccount[]>
      addAccount(): Promise<void>
      removeAccount(id: string): Promise<void>
      refresh(id: string | 'all'): Promise<void>
      setPaused(id: string, paused: boolean): Promise<void>
      onAccountUpdated(cb: (account: PublicAccount) => void): () => void
    }
  }
}

export type SortMode = 'soonest' | 'lowest'

type State = {
  accounts: PublicAccount[]
  sort: SortMode
  loading: boolean
  error: string | null
  busy: boolean
  setSort(sort: SortMode): void
  refresh(id: string | 'all'): Promise<void>
  setPaused(id: string, paused: boolean): Promise<void>
  removeAccount(id: string): Promise<void>
  addAccount(): Promise<void>
}

export const useStore = create<State>((set, get) => ({
  accounts: [],
  sort: 'soonest',
  loading: true,
  error: null,
  busy: false,

  setSort: (sort) => set({ sort }),

  refresh: async (id) => {
    set({ busy: true, error: null })
    try {
      await window.quota.refresh(id)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ busy: false })
    }
  },

  setPaused: async (id, paused) => {
    set({ error: null })
    try {
      await window.quota.setPaused(id, paused)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  removeAccount: async (id) => {
    const snapshot = get().accounts
    // Optimistic: the card disappears immediately, and comes back if the
    // remove actually fails.
    set({ accounts: snapshot.filter((a) => a.id !== id), error: null })
    try {
      await window.quota.removeAccount(id)
    } catch (err) {
      set({ accounts: snapshot, error: err instanceof Error ? err.message : String(err) })
    }
  },

  addAccount: async () => {
    set({ busy: true, error: null })
    try {
      await window.quota.addAccount()
      set({ accounts: await window.quota.listAccounts() })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ busy: false })
    }
  },
}))

/** Loads the initial snapshot and subscribes to per-account updates. */
export async function initStore(): Promise<() => void> {
  const store = useStore

  try {
    store.setState({ accounts: await window.quota.listAccounts(), loading: false })
  } catch (err) {
    store.setState({ loading: false, error: err instanceof Error ? err.message : String(err) })
    return () => {}
  }

  return window.quota.onAccountUpdated((account) => {
    store.setState((state) => {
      const index = state.accounts.findIndex((a) => a.id === account.id)
      if (index === -1) return { accounts: [...state.accounts, account] }
      const accounts = state.accounts.slice()
      accounts[index] = account
      return { accounts }
    })
  })
}

/** Groups the flat model list into renderable pools. */
export function poolsOf(account: PublicAccount): QuotaPool[] {
  return groupIntoPools(account.quota)
}

export function accountIsLow(account: PublicAccount): boolean {
  return isLowQuota(groupIntoPools(account.quota))
}

export function accountHasQuotaData(account: PublicAccount): boolean {
  return hasQuotaData(groupIntoPools(account.quota))
}

/** Soonest upcoming reset across all of an account's pools. */
export function nextResetOf(account: PublicAccount): number | null {
  const times = groupIntoPools(account.quota)
    .map((pool) => pool.resetAt)
    .filter((t): t is number => t !== null)
  return times.length > 0 ? Math.min(...times) : null
}

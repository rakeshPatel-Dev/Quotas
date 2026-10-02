import { useEffect, useMemo } from 'react'
import type { JSX } from 'react'
import quotasLogo from '../../../public/quotas.svg'
import { AccountCard } from './AccountCard'
import { TopBar } from './TopBar'
import { useNow } from '../hooks/useNow'
import {
  accountHasQuotaData,
  accountIsLow,
  initStore,
  nextResetOf,
  useStore,
} from '../store'

export function App(): JSX.Element {
  const now = useNow()
  const {
    accounts,
    sort,
    loading,
    error,
    busy,
    setSort,
    refresh,
    setPaused,
    removeAccount,
    addAccount,
  } = useStore()

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    void initStore().then((dispose) => {
      unsubscribe = dispose
    })
    return () => unsubscribe?.()
  }, [])

  const ordered = useMemo(() => {
    const sorted = accounts.slice()
    sorted.sort((a, b) => {
      // Accounts needing action float to the top in both orderings.
      const aLow = accountIsLow(a)
      const bLow = accountIsLow(b)
      if (aLow !== bLow) return aLow ? -1 : 1
      if (a.paused !== b.paused) return a.paused ? 1 : -1

      if (sort === 'lowest') {
        const aFrac = lowestFraction(a.quota.map((m) => m.remainingFraction))
        const bFrac = lowestFraction(b.quota.map((m) => m.remainingFraction))
        if (aFrac !== bFrac) return aFrac - bFrac
      }
      const aReset = nextResetOf(a) ?? Number.MAX_SAFE_INTEGER
      const bReset = nextResetOf(b) ?? Number.MAX_SAFE_INTEGER
      return aReset - bReset
    })
    return sorted
  }, [accounts, sort])

  const withData = accounts.filter(accountHasQuotaData).length
  const low = accounts.filter(accountIsLow).length
  const nextReset = useMemo(() => {
    const times = accounts.map(nextResetOf).filter((t): t is number => t !== null)
    return times.length > 0 ? Math.min(...times) : null
  }, [accounts])

  return (
    <div className="min-h-screen bg-base text-ink antialiased">
      <TopBar
        total={accounts.length}
        withData={withData}
        low={low}
        nextReset={nextReset}
        now={now}
        sort={sort}
        busy={busy}
        onSort={setSort}
        onRefreshAll={() => void refresh('all')}
        onAdd={() => void addAccount()}
      />

      <main className="mx-auto max-w-[1360px] px-6 py-5">
        {error && (
          <div
            role="alert"
            className="mb-4 border border-critical/25 bg-critical/[0.07] px-3 py-2.5 text-meta text-critical"
          >
            {error}
          </div>
        )}

        {loading ? (
          <p className="py-20 text-center text-meta text-ink-faint">Loading accounts…</p>
        ) : ordered.length === 0 ? (
          <EmptyState onAdd={() => void addAccount()} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] items-start gap-4">
            {ordered.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                now={now}
                busy={busy}
                onRefresh={() => void refresh(account.id)}
                onPause={(paused) => void setPaused(account.id, paused)}
                onRemove={() => void removeAccount(account.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function lowestFraction(fractions: (number | null)[]): number {
  const known = fractions.filter((f): f is number => f !== null)
  return known.length > 0 ? Math.min(...known) : Number.MAX_SAFE_INTEGER
}

function EmptyState({ onAdd }: { onAdd: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-28 text-center">
      <img src={quotasLogo} alt="Quotas logo" width={56} height={56} className="opacity-80" />
      <div className="space-y-1.5">
        <p className="text-title font-medium text-ink">No accounts yet</p>
        <p className="mx-auto max-w-sm text-body leading-relaxed text-ink-faint">
          Add a Google account to start tracking quota. Sign-in opens in your browser; the app only stores the
          refresh token, encrypted.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-1 bg-ink px-3 py-1.5 text-meta font-semibold text-ink-inverse transition-opacity duration-150 ease-out hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        Add your first account
      </button>
    </div>
  )
}
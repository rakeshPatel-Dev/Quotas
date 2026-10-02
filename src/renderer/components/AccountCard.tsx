import type { JSX } from 'react'
import { useState } from 'react'
import type { PublicAccount } from '../../shared/types'
import { StatusChip } from './StatusChip'
import { PoolRow } from './PoolRow'
import { formatRelative } from '../lib/format'
import { accountHasQuotaData, accountIsLow, poolsOf } from '../store'

function Action({
  onClick,
  children,
  tone = 'default',
  title,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  tone?: 'default' | 'danger'
  title?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`border border-transparent px-2 py-1 text-meta transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40 ${
        tone === 'danger'
          ? 'text-critical hover:border-critical/30 hover:bg-critical/10'
          : 'text-ink-faint hover:bg-raised hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

export function AccountCard({
  account,
  now,
  busy,
  onRefresh,
  onPause,
  onRemove,
}: {
  account: PublicAccount
  now: number
  busy: boolean
  onRefresh: () => void
  onPause: (paused: boolean) => void
  onRemove: () => void
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const pools = poolsOf(account)
  const low = accountIsLow(account)
  const metered = accountHasQuotaData(account)

  return (
    <article
      className={`group relative flex flex-col gap-4 border bg-surface p-4 shadow-card transition-colors duration-200 ease-out ${
        low ? 'border-caution/40' : 'border-line hover:border-line-strong'
      }`}
    >
      {/* A single bright rule on the left edge marks the account needing action. */}
      {low && <span className="absolute inset-y-0 left-0 w-0.5 bg-caution" />}

      <header className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-title font-medium text-ink">{account.email}</h2>
          <StatusChip status={account.status} />
        </div>

        {/* Tier and freshness read as data, not as prose. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-meta text-ink-faint">
            {account.planType ?? (metered ? 'Starter quota' : 'No usage meter')}
          </span>
          <span className="text-meta text-ink-faint/40">·</span>
          <span className="text-meta text-ink-faint">{formatRelative(account.fetchedAt, now)}</span>
          {account.paused && <span className="text-meta text-warn">· paused</span>}
        </div>
      </header>

      {account.lastError && (
        <p className="border border-critical/25 bg-critical/[0.07] px-3 py-2 text-meta leading-relaxed text-critical">
          {account.lastError}
        </p>
      )}

      <div className="flex-1 space-y-3.5">
        {pools.length === 0 ? (
          <p className="py-1 text-meta text-ink-faint">
            {account.status === 'refreshing' ? 'Fetching quota…' : 'No quota data yet'}
          </p>
        ) : (
          pools.map((pool) => <PoolRow key={pool.key} pool={pool} now={now} />)
        )}
      </div>

      <footer className="flex items-center justify-end gap-1 border-t border-line pt-2">
        {account.status === 'auth_error' && (
          <button
            type="button"
            onClick={onRefresh}
            className="mr-auto bg-critical px-2.5 py-1 text-meta font-medium text-white transition-opacity duration-150 hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-critical"
          >
            Re-sign in
          </button>
        )}

        {confirming ? (
          <span className="mr-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onRemove}
              className="bg-critical px-2.5 py-1 text-meta font-medium text-white transition-opacity duration-150 hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-critical"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-2 py-1 text-meta text-ink-faint transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </span>
        ) : (
          <Action onClick={() => setConfirming(true)} tone="danger" title={`Remove ${account.email}`}>
            <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100">
              Remove
            </span>
          </Action>
        )}

        <Action onClick={() => onPause(!account.paused)} disabled={busy}>
          {account.paused ? 'Resume' : 'Pause'}
        </Action>
        <Action onClick={onRefresh} disabled={busy} title="Fetch now">
          Refresh
        </Action>
      </footer>
    </article>
  )
}
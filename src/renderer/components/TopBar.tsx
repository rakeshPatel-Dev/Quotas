import type { JSX } from 'react'
import type { SortMode } from '../store'
import { formatCountdown } from '../lib/format'
import quotasLogo from '../../../public/quotas.svg'

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; title: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="flex items-center border border-line bg-surface p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          title={option.title}
          aria-pressed={value === option.value}
          className={`px-2.5 py-1 text-meta transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
            value === option.value
              ? 'bg-raised text-ink'
              : 'text-ink-faint hover:bg-raised/60 hover:text-ink-dim'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function TopBar({
  total,
  withData,
  low,
  nextReset,
  now,
  sort,
  busy,
  onSort,
  onRefreshAll,
  onAdd,
}: {
  total: number
  withData: number
  low: number
  nextReset: number | null
  now: number
  sort: SortMode
  busy: boolean
  onSort: (sort: SortMode) => void
  onRefreshAll: () => void
  onAdd: () => void
}): JSX.Element {
  const unmetered = total - withData

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-base/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <img src={quotasLogo} alt="Quotas logo" width={28} height={28} className="shrink-0" />
            <h1 className="text-heading font-semibold tracking-tight text-ink">Antigravity Quotas</h1>
          </div>

          {/* Most actionable facts lead; the rest is secondary. */}
          <p className="mt-1 text-meta text-ink-faint">
            {total === 0 ? (
              'No accounts'
            ) : (
              <>
                {low > 0 && <span className="text-caution">{low} low</span>}
                {low > 0 && unmetered > 0 && <span> · </span>}
                {unmetered > 0 && (
                  <>
                    <span>{unmetered} unmetered</span>
                    <span> · </span>
                  </>
                )}
                <span>
                  {withData} of {total} metered
                </span>
                {nextReset !== null && (
                  <>
                    {' · next reset '}
                    <span className="font-mono tabular-nums text-ink-dim">
                      {formatCountdown(nextReset, now)}
                    </span>
                  </>
                )}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Segmented
            value={sort}
            onChange={onSort}
            options={[
              { value: 'soonest', label: 'Soonest', title: 'Sort by soonest reset' },
              { value: 'lowest', label: 'Lowest', title: 'Sort by lowest remaining quota' },
            ]}
          />

          <button
            type="button"
            onClick={onRefreshAll}
            disabled={busy || total === 0}
            className="border border-line bg-surface px-2.5 py-1.5 text-meta text-ink-dim transition-colors duration-150 ease-out hover:border-line-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
          >
            {busy ? 'Refreshing…' : 'Refresh all'}
          </button>

          <button
            type="button"
            onClick={onAdd}
            className="bg-ink px-2.5 py-1.5 text-meta font-semibold text-ink-inverse transition-opacity duration-150 ease-out hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Add account
          </button>
        </div>
      </div>
    </header>
  )
}
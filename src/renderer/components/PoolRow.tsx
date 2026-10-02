import type { JSX } from 'react'
import type { QuotaPool } from '../../shared/pools'
import { LOW_QUOTA_THRESHOLD, poolTitle } from '../../shared/pools'
import { formatCountdown, formatPercent } from '../lib/format'

/**
 * The bar states the quota level: green while there is room, yellow once a pool
 * is nearly gone, red when it is spent. Model families are deliberately not
 * colour-coded — the pool title already names them and two families never share
 * a bar, so a colour here would be decoration competing with meaning.
 */
function fillClass(pool: QuotaPool): string {
  const fraction = pool.remainingFraction
  if (pool.isExhausted || fraction === 0) return 'bg-critical'
  if (fraction !== null && fraction <= LOW_QUOTA_THRESHOLD) return 'bg-caution'
  return 'bg-healthy'
}

export function PoolRow({ pool, now }: { pool: QuotaPool; now: number }): JSX.Element {
  const known = pool.remainingFraction !== null
  const fraction = pool.remainingFraction ?? 0
  const low = known && fraction <= LOW_QUOTA_THRESHOLD

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="truncate text-small text-ink-dim">{poolTitle(pool)}</span>

        <div className="flex shrink-0 items-baseline gap-2.5">
          {known && (
            <span className={`font-mono text-small tabular-nums ${low ? 'text-caution' : 'text-ink'}`}>
              {formatPercent(pool.remainingFraction)}
            </span>
          )}
          <span className="font-mono text-meta tabular-nums text-ink-faint">
            {pool.resetAt === null ? 'no reset' : formatCountdown(pool.resetAt, now)}
          </span>
        </div>
      </div>

      {known ? (
        <div
          className="h-[3px] overflow-hidden bg-line"
          role="meter"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${poolTitle(pool)} remaining quota`}
        >
          <div
            className={`h-full transition-[width] duration-700 ease-out ${fillClass(pool)}`}
            style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 1.5 : 0)}%` }}
          />
        </div>
      ) : (
        // Google provisioned no usage meter for this pool. A flat hairline says
        // "nothing to show" without implying the pool is empty.
        <div className="h-[3px] bg-line/60" />
      )}
    </div>
  )
}
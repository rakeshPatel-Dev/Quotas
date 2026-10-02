import type { JSX } from 'react'
import type { AccountStatus } from '../../shared/types'

/**
 * Status is the only place colour carries meaning. The ladder is four distinct
 * steps so "low", "throttled" and "dead" never read the same.
 */
const STATUS: Record<AccountStatus, { label: string; dot: string; text: string }> = {
  ok: { label: 'Live', dot: 'bg-healthy', text: 'text-ink-faint' },
  refreshing: { label: 'Syncing', dot: 'bg-ink-dim animate-pulse', text: 'text-ink-dim' },
  rate_limited: { label: 'Throttled', dot: 'bg-warn', text: 'text-warn' },
  auth_error: { label: 'Sign-in expired', dot: 'bg-critical', text: 'text-critical' },
  error: { label: 'Failed', dot: 'bg-critical', text: 'text-critical' },
}

export function StatusChip({ status }: { status: AccountStatus }): JSX.Element | null {
  const meta = STATUS[status]

  // A healthy account needs no badge; its own numbers already say it is fine.
  if (status === 'ok') return null

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-micro uppercase ${meta.text}`}
      title={meta.label}
    >
      <span className={`h-1 w-1 ${meta.dot}`} />
      {meta.label}
    </span>
  )
}
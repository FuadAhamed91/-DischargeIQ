import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AlertHour } from '@/lib/analytics/alerts'

const HOUR_MS = 60 * 60 * 1000

/**
 * Alerts raised in each of the last 24 hours: one column per hour, the hour
 * we are in on the right. Hovering a column shows its count; the same numbers
 * are in a table for screen readers.
 */
export function AlertsByHour({ hours, tz }: { hours: AlertHour[]; tz: string }) {
  const total = hours.reduce((n, h) => n + h.count, 0)
  const critical = hours.reduce((n, h) => n + h.critical, 0)
  const peak = Math.max(1, ...hours.map((h) => h.count))
  const last = hours.length - 1
  const range = (h: AlertHour) =>
    `${fmt(h.start, 'HH:mm', tz)}–${fmt(new Date(new Date(h.start).getTime() + HOUR_MS), 'HH:mm', tz)}`
  // Every six hours on the clock, kept clear of both ends so a label never runs into "Now".
  const isTick = (h: AlertHour, i: number) => i >= 2 && i <= last - 4 && Number(fmt(h.start, 'H', tz)) % 6 === 0

  return (
    <section aria-labelledby="alerts-by-hour" className="rounded-lg border px-4 pb-3 pt-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="alerts-by-hour" className="text-sm font-medium">Alerts, last 24 hours</h3>
        <p className="text-xs text-muted-foreground">
          <span className="text-sm font-semibold text-foreground">{total}</span> alert{total === 1 ? '' : 's'}
          {critical > 0 && <> · {critical} critical</>}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2" aria-hidden="true">
        {/* y axis: nothing, and the busiest hour */}
        <div className="flex h-24 flex-col justify-between text-right text-[11px] leading-none text-muted-foreground tnum">
          <span className="-translate-y-1/2">{peak}</span>
          <span className="translate-y-1/2">0</span>
        </div>

        <div className="relative h-24">
          <div className="absolute inset-x-0 top-0 border-t border-border/60" />
          <div className="absolute inset-x-0 bottom-0 border-t border-border" />
          {total === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              No alerts in the last 24 hours
            </p>
          )}
          <div className="absolute inset-0 flex items-end gap-0.5">
            {hours.map((h, i) => {
              const height = `${(h.count / peak) * 100}%`
              return (
                <div key={h.start} className="group relative flex h-full flex-1 items-end justify-center rounded-sm transition-colors hover:bg-muted/60">
                  {h.count > 0 && (
                    <span
                      className="w-full max-w-3.5 rounded-t-[4px] bg-brand transition-opacity group-hover:opacity-80 dark:bg-[#1d95d8]"
                      style={{ height }}
                    />
                  )}
                  <span
                    className={cn(
                      'pointer-events-none absolute z-10 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100',
                      i <= 2 ? 'left-0' : i >= last - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                    )}
                    style={{ bottom: `calc(${height} + 6px)` }}
                  >
                    <span className="block text-xs font-semibold tnum">
                      {h.count} alert{h.count === 1 ? '' : 's'}
                      {h.critical > 0 && <span className="font-normal text-muted-foreground"> · {h.critical} critical</span>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground tnum">{range(h)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* x axis */}
        <div />
        <div className="mt-2 flex h-3 gap-0.5 text-[11px] leading-none text-muted-foreground tnum">
          {hours.map((h, i) => (
            <div key={h.start} className="relative flex-1">
              {isTick(h, i) && <span className="absolute left-0 top-0 -translate-x-1/2">{fmt(h.start, 'HH:mm', tz)}</span>}
              {i === last && <span className="absolute right-0 top-0">Now</span>}
            </div>
          ))}
        </div>
      </div>

      {total > 0 && (
        <table className="sr-only">
          <caption>Alerts raised in each hour of the last 24 hours</caption>
          <thead>
            <tr><th scope="col">Hour</th><th scope="col">Alerts</th><th scope="col">Critical</th></tr>
          </thead>
          <tbody>
            {hours.filter((h) => h.count > 0).map((h) => (
              <tr key={h.start}><th scope="row">{range(h)}</th><td>{h.count}</td><td>{h.critical}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

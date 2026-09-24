'use client'

/**
 * Recharts is ~400 KB of client JavaScript. Load the chart components only
 * when the analytics page mounts, and show a sized skeleton meanwhile so the
 * page paints immediately and nothing shifts when the chart arrives.
 */

import dynamic from 'next/dynamic'

function ChartSkeleton({ height = 260, label }: { height?: number; label: string }) {
  return (
    <div
      role="img"
      aria-label={`${label} loading`}
      className="w-full animate-pulse rounded-lg bg-muted/60"
      style={{ height }}
    />
  )
}

export const ComplianceChart = dynamic(
  () => import('./compliance-chart').then((m) => m.ComplianceChart),
  { ssr: false, loading: () => <ChartSkeleton height={220} label="Check-in trend chart" /> },
)

export const RiskDonut = dynamic(
  () => import('./risk-donut').then((m) => m.RiskDonut),
  { ssr: false, loading: () => <ChartSkeleton height={200} label="Risk distribution chart" /> },
)

export const AlertActivityChart = dynamic(
  () => import('./alert-activity-chart').then((m) => m.AlertActivityChart),
  { ssr: false, loading: () => <ChartSkeleton height={220} label="Alert activity chart" /> },
)

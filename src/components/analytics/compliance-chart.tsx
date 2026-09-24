'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

/** One day of check-ins (lib/analytics/checkins.ts, checkinTrend); null where there is nothing to measure. */
interface DataPoint {
  date: string
  answered: number | null
  tookAll: number | null
}

export function ComplianceChart({ data }: { data: DataPoint[] }) {
  if (!data.some((d) => d.answered !== null || d.tookAll !== null)) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Check-in answers will appear here once the nightly check-ins go out.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
        <Tooltip formatter={(value) => [`${value}%`]} contentStyle={{ background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: 'var(--popover-foreground)' }} itemStyle={{ color: 'var(--popover-foreground)' }} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />
        {/* Days without check-ins are gaps, not 0%; dots keep a lone day visible between them. */}
        <Line type="monotone" dataKey="answered" name="Check-ins answered" stroke="var(--teal)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} />
        <Line type="monotone" dataKey="tookAll" name="Took all their medicines" stroke="var(--brand)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

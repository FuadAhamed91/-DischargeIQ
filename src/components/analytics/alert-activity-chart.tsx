'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface AlertDay {
  date: string
  critical: number
  high: number
  medium: number
  low: number
}

export function AlertActivityChart({ data }: { data: AlertDay[] }) {
  const hasData = data.some((d) => d.critical + d.high + d.medium + d.low > 0)

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Alert activity will appear here once patients are active.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} barSize={8}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={1} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ borderRadius: '8px', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="critical" name="Critical" fill="#ef4444" stackId="a" radius={[0, 0, 0, 0]} />
        <Bar dataKey="high" name="High" fill="#f97316" stackId="a" />
        <Bar dataKey="medium" name="Medium" fill="#eab308" stackId="a" />
        <Bar dataKey="low" name="Low" fill="#22c55e" stackId="a" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

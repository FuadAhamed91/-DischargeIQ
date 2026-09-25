import { requireSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { Toaster } from '@/components/ui/sonner'
import { TourProvider } from '@/components/tour/tour-provider'

/** The roles that add patients and send care plans: the tour walks through exactly that. */
const TOUR_ROLES = ['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse']

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { profile, hospital } = await requireSession()
  const supabase = await createClient()

  // Initial badge counts for the header bell (kept live client-side afterwards)
  const [{ count: openAlerts }, { count: criticalAlerts }] = await Promise.all([
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', profile.hospital_id).eq('status', 'open'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', profile.hospital_id).eq('status', 'open').eq('severity', 'critical'),
  ])

  return (
    <TourProvider enabled={TOUR_ROLES.includes(profile.role)}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:m-2 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground">
          Skip to content
        </a>
        <Sidebar role={profile.role} hospitalName={hospital.name} whatsappNumber={hospital.whatsapp_phone_number_id} />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Header profile={profile} hospitalName={hospital.name} openAlerts={openAlerts ?? 0} criticalAlerts={criticalAlerts ?? 0} />
          {/* The one scroller. relative: anything absolutely positioned inside it (a screen-reader-only
              label, a hidden input) is placed here too — placed against the page instead, it made the
              whole page scroll and a second scrollbar appear beside this one. */}
          <main id="main" tabIndex={-1} className="relative flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 focus:outline-none">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
        <Toaster richColors position="top-right" />
      </div>
    </TourProvider>
  )
}

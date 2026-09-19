/**
 * Re-mounts on every navigation, so each page (or its loading skeleton) eases
 * in instead of snapping. Short and transform/opacity-only; skipped entirely
 * under prefers-reduced-motion.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out">
      {children}
    </div>
  )
}

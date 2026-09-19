import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FileQuestion } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-5 max-w-sm mx-auto px-6">
        <div className="w-16 h-16 rounded-2xl bg-brand-soft flex items-center justify-center mx-auto">
          <FileQuestion className="w-8 h-8 text-brand" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
          <p className="text-muted-foreground text-sm mt-2">
            The page you are looking for does not exist or you do not have access.
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <Link href="/">
            <Button style={{ backgroundColor: 'var(--brand)' }}>Go to dashboard</Button>
          </Link>
          <Link href="/patients">
            <Button variant="outline">View patients</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

import { Badge } from '@/components/ui/badge'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { LanguageCode } from '@/types/enums'

interface LanguageBadgeProps {
  language: LanguageCode
}

export function LanguageBadge({ language }: LanguageBadgeProps) {
  return (
    <Badge variant="secondary" className="font-normal text-xs">
      {SUPPORTED_LANGUAGES[language] ?? language}
    </Badge>
  )
}

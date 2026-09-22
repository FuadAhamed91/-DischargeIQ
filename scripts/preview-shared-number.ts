/**
 * Prints what a shared WhatsApp number hears — the "who is this message
 * about?" question (first ask, repeat, with a message held) and the
 * confirmation after a switch — so wording can be checked without sending
 * anything. No network or keys needed.
 * Run with:  npx --yes tsx scripts/preview-shared-number.ts [en|ar|hi|ta|tl]
 */
import { renderMessageBody } from '@/lib/whatsapp/client'
import { buildWhoIsThisAboutMessage, buildNowAboutMessage } from '@/lib/whatsapp/routing-templates'
import type { LanguageCode } from '@/types/enums'

const language = (process.argv[2] ?? 'en') as LanguageCode
const to = '+971500000001'
const options = [{ name: 'Aisha Rahman' }, { name: 'Bilal Rahman' }, { name: 'Noor Rahman' }]

const show = (title: string, body: string) => {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}\n`)
  console.log(body)
}

show('first ask, message held', renderMessageBody(buildWhoIsThisAboutMessage({ to, options, language, repeat: false, holding: true })))
show('after "switch" (nothing held)', renderMessageBody(buildWhoIsThisAboutMessage({ to, options: options.slice(0, 2), language, repeat: false, holding: false })))
show('repeat after an answer that made no sense', renderMessageBody(buildWhoIsThisAboutMessage({ to, options: options.slice(0, 2), language, repeat: true, holding: true })))
show('confirmation after a bare name or number', renderMessageBody(buildNowAboutMessage({ to, patientName: 'Bilal Rahman', language })))
console.log()

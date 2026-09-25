export const siteConfig = {
  name: 'CareLoop',
  description: 'Enterprise post-discharge patient care platform',
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.careloop.com',
  primaryColor: '#1C0770',
  secondaryColor: '#30D5C8',
  links: {
    support: 'mailto:support@careloop.com',
  },
  /**
   * Demo: the one WhatsApp number every patient is added with. The Add
   * patient form shows it filled in and locked, and the server saves it
   * whatever the form sends, so every care plan, check-in and answer reaches
   * the demo phone. Patients on one number are told apart by the
   * shared-number routing (lib/whatsapp/routing.ts). Set it to null to let
   * staff type each patient's own number again.
   */
  demoWhatsAppNumber: '+971505263427' as string | null,
}

/** The number a new patient must get, when the demo fixes one; otherwise the one typed. */
export function whatsAppNumberFor(typed: string): string {
  return siteConfig.demoWhatsAppNumber ?? typed
}

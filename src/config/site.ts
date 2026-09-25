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
   * Demo: the team's test phone, already joined to the WhatsApp sandbox. Add
   * patient fills it in with "Use demo number" for anyone who doesn't want to
   * use their own phone (their own works once it has joined the sandbox:
   * lib/whatsapp/sandbox.ts). Several patients on it are told apart by the
   * shared-number routing (lib/whatsapp/routing.ts). null hides the button.
   */
  demoWhatsAppNumber: '+971505263427' as string | null,
}

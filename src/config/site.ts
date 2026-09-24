export const siteConfig = {
  name: 'DischargeIQ',
  description: 'Enterprise post-discharge patient care platform',
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.dischargeiq.com',
  primaryColor: '#1C0770',
  secondaryColor: '#30D5C8',
  links: {
    support: 'mailto:support@dischargeiq.com',
  },
  /**
   * Hackathon demo: no login screen. A visitor without a session is signed in
   * as the hospital's admin (lib/supabase/demo-sign-in.ts), so anyone with the
   * link can see and do everything that admin can. Set to false to bring the
   * login screen back.
   */
  demoSignIn: true,
}

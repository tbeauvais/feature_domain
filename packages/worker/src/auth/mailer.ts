// Sending sign-in codes: Cloudflare Email Sending on the Worker's `EMAIL` binding (wrangler.jsonc), or a list in tests.

/** One email to send. */
export interface Mail {
  to: string
  subject: string
  text: string
  /** The name the email comes from: the app's. */
  fromName: string
}

/** Sends email. */
export interface Mailer {
  send(mail: Mail): Promise<void>
}

/** A mailer that keeps what it sends (tests). */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = []
  async send(mail: Mail) {
    this.sent.push(mail)
  }
}

/** The most mails the development mailer keeps. */
const DEV_MAILS = 50

/**
 * Development's mailer (the apps' domain is localhost): prints each email to the Worker's log, so a code can be read
 * in `npm run dev`, and keeps the last ones for the end-to-end tests (GET /api/v1/app/dev/mail, served only there).
 */
export class DevMailer implements Mailer {
  readonly sent: Mail[] = []
  async send(mail: Mail) {
    this.sent.push(mail)
    if (this.sent.length > DEV_MAILS) this.sent.shift()
    console.log(`Sign-in email to ${mail.to} (${mail.subject}):\n${mail.text}`)
  }
}

/** Sends through Cloudflare Email Sending, from the platform's address (MAIL_FROM) under the app's name. */
export class CloudflareMailer implements Mailer {
  constructor(
    private readonly binding: SendEmail,
    private readonly from: string,
  ) {}

  async send(mail: Mail) {
    await this.binding.send({ from: { name: mail.fromName, email: this.from }, to: mail.to, subject: mail.subject, text: mail.text })
  }
}

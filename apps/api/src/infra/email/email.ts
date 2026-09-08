// Thin wrapper around Resend email sending. Plain fetch, no SDK dependency —
// we only use one endpoint (POST /emails), errors are simple, and pulling in an SDK just for
// types isn't worth it.
//
// Config:
//   RESEND_API_KEY  required — get one at https://resend.com/api-keys
//   EMAIL_FROM      required — sender address. Three forms:
//     1. 'onboarding@resend.dev'  Resend sandbox sender domain — **can only send to the address
//        bound to your Resend account** (local self-testing)
//     2. 'login@<your-verified-domain>'  for production, can send to any address
//     3. 'jixie <login@xxx>'      a display name also works
//
// When not configured locally (see isEmailConfigured), in dev the auth operation prints the code to
// the console instead of actually sending email.

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

// Whether a real email service is configured. When not configured + non-production, the auth
// operation falls back to the dev console.
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error('Email service not configured: RESEND_API_KEY or EMAIL_FROM missing in env');
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

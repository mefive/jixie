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
// When not configured locally (see isEmailConfigured), in dev the auth route prints the code to
// the console instead of actually sending email.

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

// Whether a real email service is configured. When not configured + non-production, the auth
// route falls back to the dev console.
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

// 6-digit verification code email template. HTML uses inline styles (email clients handle <style>
// blocks poorly); no plain-text version is sent.
export function buildVerificationEmail(code: string): { subject: string; html: string } {
  const subject = `机械系 登录验证码：${code}`;
  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:#1f2329;line-height:1.6;padding:32px;">
    <div style="max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;font-size:20px;">机械系 登录</h2>
      <p style="margin:0 0 16px;">你的登录验证码：</p>
      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;font-weight:bold;background:#f5f5f7;padding:16px 20px;border-radius:8px;text-align:center;margin:0 0 16px;">${code}</div>
      <p style="margin:0 0 8px;color:#8a9099;font-size:14px;">10 分钟内有效。</p>
      <p style="margin:0;color:#8a9099;font-size:14px;">如果不是你本人操作，请忽略此邮件。</p>
    </div>
  </body>
</html>`;
  return { subject, html };
}

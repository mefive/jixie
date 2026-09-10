import type { Locale } from '@jixie/shared';
import { t } from '#i18n/index.js';

// 6-digit verification code email template. HTML uses inline styles (email clients handle <style>
// blocks poorly); no plain-text version is sent.
export function buildVerificationEmail(
  code: string,
  locale: Locale,
): { subject: string; html: string } {
  const subject = t(locale, 'emailLoginSubject', { code });
  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:#1f2329;line-height:1.6;padding:32px;">
    <div style="max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;font-size:20px;">${t(locale, 'emailLoginHeading')}</h2>
      <p style="margin:0 0 16px;">${t(locale, 'emailLoginPrompt')}</p>
      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;font-weight:bold;background:#f5f5f7;padding:16px 20px;border-radius:8px;text-align:center;margin:0 0 16px;">${code}</div>
      <p style="margin:0 0 8px;color:#8a9099;font-size:14px;">${t(locale, 'emailLoginValidity')}</p>
      <p style="margin:0;color:#8a9099;font-size:14px;">${t(locale, 'emailLoginIgnore')}</p>
    </div>
  </body>
</html>`;
  return { subject, html };
}

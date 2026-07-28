import type { Locale, SignalItem } from '@jixie/shared';
import { isEmailConfigured, sendEmail } from '../lib/email.js';
import { prisma } from '../lib/prisma.js';
import { t } from '../i18n/messages.js';

export interface Notifier {
  send(input: { to: string; subject: string; html: string }): Promise<void>;
}

const emailNotifier: Notifier = {
  send: sendEmail,
};

/** Send the durable result after it and its Job have committed. Notification failures never change
 * the signal result; they are recorded on SignalRun for the Today page and operational diagnosis. */
export async function notifySignalRun(
  runId: string,
  notifier: Notifier = emailNotifier,
): Promise<void> {
  const run = await prisma.signalRun.findUnique({
    where: { id: runId },
    include: {
      user: { select: { email: true } },
      deployment: { select: { strategyName: true, locale: true } },
    },
  });
  if (!run || (run.status !== 'done' && run.status !== 'error')) {
    return;
  }

  if (!isEmailConfigured() && notifier === emailNotifier) {
    if (process.env.NODE_ENV === 'production') {
      await recordNotificationError(run.id, 'Email service is not configured');
    } else {
      console.log(`[signals] email notification skipped in development for run ${run.id}`);
    }
    return;
  }

  const locale = run.deployment.locale === 'en' ? 'en' : 'zh';
  const message = buildSignalEmail({
    locale,
    strategyName: run.deployment.strategyName,
    tradeDate: run.tradeDate,
    execDate: run.execDate,
    status: run.status,
    signals: parseSignals(run.signals),
    error: run.error,
    appUrl: process.env.JIXIE_PUBLIC_URL,
  });
  try {
    await notifier.send({ to: run.user.email, ...message });
    await prisma.signalRun.update({
      where: { id: run.id },
      data: { notifiedAt: new Date(), notificationError: null },
    });
  } catch (error) {
    await recordNotificationError(run.id, error instanceof Error ? error.message : String(error));
  }
}

export function buildSignalEmail(input: {
  locale: Locale;
  strategyName: string;
  tradeDate: string;
  execDate: string;
  status: 'done' | 'error';
  signals: SignalItem[];
  error: string | null;
  appUrl?: string;
}): { subject: string; html: string } {
  const buys = input.signals.filter((signal) => signal.action === 'buy').length;
  const sells = input.signals.filter((signal) => signal.action === 'sell').length;
  const subject =
    input.status === 'error'
      ? t(input.locale, 'signalEmailErrorSubject', { tradeDate: formatDate(input.tradeDate) })
      : input.signals.length === 0
        ? t(input.locale, 'signalEmailEmptySubject', { execDate: formatDate(input.execDate) })
        : t(input.locale, 'signalEmailSubject', {
            execDate: formatDate(input.execDate),
            buys,
            sells,
          });

  const content =
    input.status === 'error'
      ? `<p style="color:#b42318;">${escapeHtml(
          t(input.locale, 'signalEmailError', { error: input.error ?? 'unknown error' }),
        )}</p>`
      : input.signals.length === 0
        ? `<p>${escapeHtml(t(input.locale, 'signalEmailEmpty'))}</p>`
        : signalTable(input.signals, input.locale);
  const link = input.appUrl
    ? `<p style="margin-top:24px;"><a href="${escapeHtml(input.appUrl.replace(/\/$/, ''))}/signals" style="color:#111827;font-weight:600;">${escapeHtml(t(input.locale, 'signalEmailOpenPage'))}</a></p>`
    : '';

  return {
    subject,
    html: `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:#1f2329;line-height:1.6;padding:32px;">
    <div style="max-width:680px;margin:0 auto;">
      <h2 style="margin:0 0 8px;font-size:20px;">${escapeHtml(
        t(input.locale, 'signalEmailHeading', { strategy: input.strategyName }),
      )}</h2>
      <p style="margin:0 0 20px;color:#667085;">${formatDate(input.tradeDate)} → ${formatDate(input.execDate)}</p>
      ${content}
      ${
        input.status === 'done'
          ? `<p style="margin-top:20px;color:#667085;font-size:13px;">${escapeHtml(
              t(input.locale, 'signalEmailReferenceNote'),
            )}</p>`
          : ''
      }
      ${link}
    </div>
  </body>
</html>`,
  };
}

function signalTable(signals: SignalItem[], locale: Locale): string {
  const rows = signals
    .map(
      (signal) => `<tr>
        <td style="padding:8px;border-bottom:1px solid #eaecf0;">${escapeHtml(signal.name)}</td>
        <td style="padding:8px;border-bottom:1px solid #eaecf0;font-family:monospace;">${escapeHtml(signal.code)}</td>
        <td style="padding:8px;border-bottom:1px solid #eaecf0;color:${signal.action === 'buy' ? '#b42318' : '#067647'};">${escapeHtml(t(locale, signal.action === 'buy' ? 'signalEmailBuy' : 'signalEmailSell'))}</td>
        <td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:right;">${signal.shares.toLocaleString()}</td>
        <td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:right;">¥${signal.refPrice.toFixed(2)}</td>
      </tr>`,
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tbody>${rows}</tbody>
  </table>`;
}

function parseSignals(value: unknown): SignalItem[] {
  return Array.isArray(value) ? (value as unknown as SignalItem[]) : [];
}

async function recordNotificationError(runId: string, message: string): Promise<void> {
  await prisma.signalRun
    .update({ where: { id: runId }, data: { notificationError: message } })
    .catch(() => {});
}

function formatDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

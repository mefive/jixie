// Resend 邮件发送的薄封装。直接 fetch 不依赖 SDK——
// 只用一个端点（POST /emails），错误形态简单，引入 SDK 只为类型不划算。
//
// 配置：
//   RESEND_API_KEY  必填——https://resend.com/api-keys 申请
//   EMAIL_FROM      必填——发件邮箱。三种形态：
//     1. 'onboarding@resend.dev'  Resend 沙箱发件域，**只能发到你 Resend 账号绑的邮箱**（本地自测）
//     2. 'login@<你的已验证域名>'  生产用，能发到任意邮箱
//     3. 'jixie <login@xxx>'      带显示名也行
//
// 本地未配置时（见 isEmailConfigured），auth 路由在 dev 下改为把验证码打印到控制台，不真发邮件。

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

// 是否配置了真实邮件服务。未配置 + 非生产时，auth 路由回退到 dev 控制台。
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

// 6 位验证码邮件模板。HTML 用 inline style（邮箱客户端对 <style> 块兼容差）；不发 plain-text 版本。
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

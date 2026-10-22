// Admin script to generate invite codes.
//
// Usage:
//   pnpm --filter api gen:invite                   # generate 1
//   pnpm --filter api gen:invite 5                 # generate 5
//   pnpm --filter api gen:invite 3 "for Zhang / Team A"   # 3 with a note
//
// Output: one invite code per line, easy to copy and forward. No Resend, no email sent — just INSERTs into the DB.

import { prisma, withDatabase, closeDatabase, getDatabase } from '#infra/database/prisma.js';
import { generateInviteCode } from '../invite-code.js';

/**
 * 解析邀请生成参数、创建邀请并输出结果，负责 CLI 资源收尾。
 *
 * Parse invitation arguments, create the invite and print its result with CLI cleanup.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const count = args[0] ? Number.parseInt(args[0], 10) : 1;
  const note = args[1] ?? null;

  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('count must be an integer between 1 and 100');
  }

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(generateInviteCode());
  }

  await getDatabase().inviteCode.createMany({
    data: codes.map((code) => ({ code, note })),
  });

  for (const code of codes) {
    console.log(code);
  }
}

await withDatabase(prisma, main)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase(prisma));

// Admin script to generate invite codes.
//
// Usage:
//   pnpm --filter api gen:invite                   # generate 1
//   pnpm --filter api gen:invite 5                 # generate 5
//   pnpm --filter api gen:invite 3 "for Zhang / Team A"   # 3 with a note
//
// Output: one invite code per line, easy to copy and forward. No Resend, no email sent — just INSERTs into the DB.

import { prisma } from '../src/lib/prisma.js';
import { generateInviteCode } from '../src/lib/inviteCode.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const count = args[0] ? Number.parseInt(args[0], 10) : 1;
  const note = args[1] ?? null;

  if (!Number.isInteger(count) || count < 1 || count > 100) {
    console.error('count must be an integer between 1 and 100');
    process.exit(1);
  }

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(generateInviteCode());
  }

  await prisma.inviteCode.createMany({
    data: codes.map((code) => ({ code, note })),
  });

  for (const code of codes) {
    console.log(code);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

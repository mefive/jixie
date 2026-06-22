// 生成邀请码 admin 脚本。
//
// 用法：
//   pnpm --filter api gen:invite                   # 生成 1 个
//   pnpm --filter api gen:invite 5                 # 生成 5 个
//   pnpm --filter api gen:invite 3 "给老张/团队A"   # 3 个 + note
//
// 输出：每行一个邀请码，方便复制转发。不连 Resend、不发邮件——只在 DB 里 INSERT。

import { prisma } from '../src/lib/prisma.js';
import { generateInviteCode } from '../src/lib/inviteCode.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const count = args[0] ? Number.parseInt(args[0], 10) : 1;
  const note = args[1] ?? null;

  if (!Number.isInteger(count) || count < 1 || count > 100) {
    console.error('count 必须是 1~100 的整数');
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

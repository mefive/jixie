// @prisma/client 6.x 仍是 CJS。Node 严格 ESM 不允许从 CJS 具名导入，
// 只能拿默认导出整体再解构——dev(tsx) 和打包后都适用。
import pkg from '@prisma/client';

const { PrismaClient } = pkg;

export const prisma = new PrismaClient();
export type Prisma = typeof prisma;

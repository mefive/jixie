// @prisma/client 6.x is still CJS. Strict ESM in Node disallows named imports from CJS,
// so we take the default export and destructure it — works in both dev (tsx) and after build.
import pkg from '@prisma/client';

const { PrismaClient } = pkg;

export const prisma = new PrismaClient();
export type Prisma = typeof prisma;

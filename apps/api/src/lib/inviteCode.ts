import { randomBytes } from 'node:crypto';

// Crockford Base32：32 个字符的字母表，去掉 I/L/O/U 避免与 1/0/V 视觉混淆。
// 12 位 = 60 bit 熵 ≈ 1.15e18 种组合，碰撞概率可忽略；用户拼读也不容易抄错。
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// 生成 12 位 Crockford Base32 邀请码。
// randomBytes 拿 12 字节，每字节取低 5 bit 做 alphabet 索引——保持 60 bit 真实熵。
export function generateInviteCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

// 把用户输入归一到规范形态：大写 + 去空白/分隔符 + 按 Crockford 规范替换易混字符（I/L→1，O→0，U→V）。
// 返回值不一定合法（长度/字符可能仍不对），由 isValidInviteCodeFormat 单独校验。
export function normalizeInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s\-_]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

// 仅校验格式：长度 + 字符集。是否真存在、是否未消费由 DB 查询判断。
export function isValidInviteCodeFormat(code: string): boolean {
  return /^[0-9A-HJ-NP-TV-Z]{12}$/.test(code);
}

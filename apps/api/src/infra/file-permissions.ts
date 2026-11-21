/**
 * 所有者、组和其他用户的写权限位。
 *
 * Write bits for the owner, group and others.
 */
export const ANY_WRITE_BIT = 0o222;

/**
 * 组和其他用户的所有权限位。
 *
 * All permission bits for the group and others.
 */
export const GROUP_OR_OTHER_PERMISSIONS = 0o077;

/**
 * 仅所有者可读，用于已封存的文件。
 *
 * Owner read access only, for sealed files.
 */
export const OWNER_READ_ONLY = 0o400;

/**
 * 仅所有者可读写。
 *
 * Read and write access for the owner only.
 */
export const OWNER_READ_WRITE = 0o600;

/**
 * 仅所有者可以列出、修改和进入目录。
 *
 * Only the owner can list, modify and traverse the directory.
 */
export const OWNER_ONLY_DIRECTORY = 0o700;

/**
 * 所有者、组和其他用户的读写执行位。
 *
 * Read, write and execute bits for all three permission classes.
 */
export const PERMISSION_BITS = 0o777;

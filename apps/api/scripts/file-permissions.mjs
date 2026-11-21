// 仅所有者可读，用于已封存的文件。
// Owner read access only, for sealed files.
export const OWNER_READ_ONLY = 0o400;

// 仅所有者可读写。
// Read and write access for the owner only.
export const OWNER_READ_WRITE = 0o600;

// 仅所有者可以列出、修改和进入目录。
// Only the owner can list, modify and traverse the directory.
export const OWNER_ONLY_DIRECTORY = 0o700;

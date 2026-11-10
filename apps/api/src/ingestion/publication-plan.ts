import { createHash } from 'node:crypto';
import { open, readdir, lstat, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { isDeepStrictEqual } from 'node:util';
import { candidateFilename } from './replica-files.js';
import { PublicationPlanError } from './errors.js';

export interface PublicationIdentity {
  runId: string;
  operation: string;
  candidateVersion: string;
  baseline: string;
}

const maximumFrameBytes = 256 * 1024 * 1024;
const operationPattern = /^[a-f0-9-]{36}$/;
const filenamePattern = /^publication-[a-f0-9-]{36}\.plan$/;

/**
 * 分块保存类型完整的临时写入清单，以摘要封存；主库事务只回放已验证内容。
 *
 * Spool typed chunks with a sealed digest; publication only replays verified content.
 */
export class PublicationPlan {
  private writer?: FileHandle;
  private readonly hash = createHash('sha256');
  private digest?: string;
  private frames = 0;
  private bytes = 0;

  private constructor(
    readonly identity: PublicationIdentity,
    readonly filename: string,
  ) {}

  static async create(identity: PublicationIdentity): Promise<PublicationPlan> {
    if (!operationPattern.test(identity.operation)) {
      throw new PublicationPlanError('Invalid publication operation');
    }
    const directory = dirname(candidateFilename(identity.runId));
    const info = await lstat(directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
      throw new PublicationPlanError('Publication directory must be private');
    }
    const plan = new PublicationPlan(
      identity,
      join(directory, `publication-${identity.operation}.plan`),
    );
    plan.writer = await open(plan.filename, 'wx', 0o600);
    try {
      await plan.append({ identity });
    } catch (error) {
      await plan.dispose();
      throw error;
    }

    return plan;
  }

  async append(value: unknown): Promise<void> {
    if (!this.writer) {
      throw new PublicationPlanError('Publication plan is not writable');
    }
    const payload = serialize(value);
    if (payload.length > maximumFrameBytes) {
      throw new PublicationPlanError('Publication chunk exceeds the bounded buffer');
    }
    const header = Buffer.alloc(36);
    header.writeUInt32BE(payload.length);
    createHash('sha256').update(payload).digest().copy(header, 4);
    await this.writer.writeFile(header);
    await this.writer.writeFile(payload);
    this.hash.update(header).update(payload);
    this.frames++;
    this.bytes += header.length + payload.length;
  }

  async seal(): Promise<void> {
    if (!this.writer) {
      throw new PublicationPlanError('Publication plan is not writable');
    }
    await this.writer.close();
    this.writer = undefined;
    this.digest = this.hash.digest('hex');
  }

  async validate(signal?: AbortSignal): Promise<void> {
    for await (const _chunk of this.read(signal)) {
      // 完整读取校验，内容不累积在内存。 / Verify the entire stream without retaining chunks.
    }
  }

  async *read(signal?: AbortSignal): AsyncGenerator<unknown> {
    if (!this.digest) {
      throw new PublicationPlanError('Publication plan is not sealed');
    }
    const file = await open(this.filename, 'r');
    const hash = createHash('sha256');
    let position = 0;
    try {
      if ((await file.stat()).size !== this.bytes) {
        throw new PublicationPlanError('Publication plan length changed');
      }
      for (let frame = 0; frame < this.frames; frame++) {
        signal?.throwIfAborted();
        const header = await readExactly(file, 36, position);
        position += header.length;
        const length = header.readUInt32BE();
        if (length > maximumFrameBytes || position + length > this.bytes) {
          throw new PublicationPlanError('Invalid publication chunk length');
        }
        const payload = await readExactly(file, length, position);
        position += length;
        if (!createHash('sha256').update(payload).digest().equals(header.subarray(4))) {
          throw new PublicationPlanError('Publication chunk checksum mismatch');
        }
        hash.update(header).update(payload);
        const value: unknown = deserialize(payload);
        if (frame === 0) {
          if (!isDeepStrictEqual(value, { identity: this.identity })) {
            throw new PublicationPlanError('Publication identity changed');
          }
        } else {
          yield value;
        }
      }
      if (
        position !== this.bytes ||
        (await file.stat()).size !== this.bytes ||
        hash.digest('hex') !== this.digest
      ) {
        throw new PublicationPlanError('Publication plan checksum mismatch');
      }
    } finally {
      await file.close();
    }
  }

  async dispose(): Promise<boolean> {
    let closed = true;
    try {
      await this.writer?.close();
    } catch {
      closed = false;
    }
    this.writer = undefined;
    const cleaned = await cleanupPublicationPlans(this.identity.runId, this.identity.operation);

    return closed && cleaned;
  }
}

async function readExactly(file: FileHandle, size: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await file.read(buffer, offset, size - offset, position + offset);
    if (!result.bytesRead) {
      throw new PublicationPlanError('Truncated publication plan');
    }
    offset += result.bytesRead;
  }

  return buffer;
}

/**
 * 仅由持有维护锁的接收／人工恢复入口清理对应 Run 的清单。
 *
 * Only an owned accept or manual recovery reclaims this run's plans.
 */
export async function cleanupPublicationPlans(runId: string, operation?: string): Promise<boolean> {
  if (operation && !operationPattern.test(operation)) {
    return true;
  }
  const directory = dirname(candidateFilename(runId));
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
      return false;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        filenamePattern.test(entry.name) &&
        entry.isFile() &&
        (!operation || entry.name === `publication-${operation}.plan`)
      ) {
        await unlink(join(directory, entry.name));
      }
    }

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

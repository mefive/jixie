export const MAX_LOG_BATCH_ENTRIES = 256;
export const MAX_LOG_BATCH_BYTES = 64 * 1024;

type SandboxLogLevel = 'info' | 'warning' | 'error';

const BATCH_PREFIX = '{"type":"log_batch","entries":[';
const BATCH_SUFFIX = ']}';
const EMPTY_BATCH_BYTES = BATCH_PREFIX.length + BATCH_SUFFIX.length;

/** Pure sandbox-side buffering: the emitter crosses the boundary only when a batch is ready. */
export class SandboxLogBuffer {
  private entries: string[] = [];
  private bytes = EMPTY_BATCH_BYTES;

  constructor(private readonly emit: (json: string) => void) {}

  append(level: SandboxLogLevel, text: string): void {
    const entry = JSON.stringify({ level, text });
    const entryBytes = utf8Bytes(entry);
    const separatorBytes = this.entries.length > 0 ? 1 : 0;
    if (this.bytes + separatorBytes + entryBytes > MAX_LOG_BATCH_BYTES) {
      this.flush();
    }

    // Preserve the existing single-line limit instead of truncating or splitting a large log.
    if (EMPTY_BATCH_BYTES + entryBytes > MAX_LOG_BATCH_BYTES) {
      this.emit(JSON.stringify({ type: 'log', level, text }));
      return;
    }

    this.bytes += entryBytes + (this.entries.length > 0 ? 1 : 0);
    this.entries.push(entry);
    if (this.entries.length >= MAX_LOG_BATCH_ENTRIES || this.bytes >= MAX_LOG_BATCH_BYTES) {
      this.flush();
    }
  }

  flush(): void {
    if (this.entries.length === 0) {
      return;
    }
    const json = BATCH_PREFIX + this.entries.join(',') + BATCH_SUFFIX;
    this.entries = [];
    this.bytes = EMPTY_BATCH_BYTES;
    this.emit(json);
  }
}

/** JSON escapes lone surrogates; valid pairs occupy four UTF-8 bytes. No Node APIs are available. */
function utf8Bytes(json: string): number {
  let bytes = 0;
  for (let index = 0; index < json.length; index++) {
    const code = json.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

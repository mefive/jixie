import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { connect, type Socket } from 'node:net';
import type { Readable, Writable } from 'node:stream';

const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface PythonFrame {
  type: string;
  [key: string]: unknown;
}

export class PythonSession {
  private buffer = Buffer.alloc(0);
  private frames: PythonFrame[] = [];
  private readers: Array<{
    resolve: (frame: PythonFrame) => void;
    reject: (error: Error) => void;
  }> = [];
  private endedError: Error | null = null;

  private constructor(
    private readonly readable: Readable,
    private readonly writable: Writable,
    private readonly stop: () => void,
  ) {
    readable.on('data', (chunk: Buffer) => this.accept(Buffer.from(chunk)));
    readable.once('end', () => this.end(new Error('Python sandbox closed the protocol')));
    readable.once('error', (error) => this.end(error));
    writable.once('error', (error) => this.end(error));
  }

  static async connect(): Promise<PythonSession> {
    if (process.env.JIXIE_PYTHON_LOCAL === '1') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JIXIE_PYTHON_LOCAL is forbidden in production');
      }
      const runner = resolve(process.cwd(), '../sandboxd/python/jixie_runner.py');
      const executable = process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3';
      const child = spawn(executable, ['-I', '-u', runner], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-8_000);
      });
      await waitForSpawn(child);
      const session = new PythonSession(child.stdout, child.stdin, () => child.kill('SIGKILL'));
      child.once('exit', (code, signal) => {
        const detail = stderr.trim() || `Python runner exited with ${signal ?? `code ${code}`}`;
        session.end(new Error(detail));
      });
      return session;
    }

    const socketPath = process.env.JIXIE_SANDBOX_SOCKET ?? '/var/lib/jixie/sandboxd.sock';
    const socket = await connectSocket(socketPath);
    return new PythonSession(socket, socket, () => socket.destroy());
  }

  async send(frame: PythonFrame): Promise<void> {
    const payload = Buffer.from(JSON.stringify(frame));
    if (payload.length > MAX_FRAME_BYTES) {
      throw new Error(`Python sandbox frame exceeds ${MAX_FRAME_BYTES} bytes`);
    }
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length);
    const packet = Buffer.concat([header, payload]);
    if (!this.writable.write(packet)) {
      await new Promise<void>((resolveDrain, rejectDrain) => {
        this.writable.once('drain', resolveDrain);
        this.writable.once('error', rejectDrain);
      });
    }
  }

  read(): Promise<PythonFrame> {
    const frame = this.frames.shift();
    if (frame) {
      return Promise.resolve(frame);
    }
    if (this.endedError) {
      return Promise.reject(this.endedError);
    }
    return new Promise((resolveFrame, rejectFrame) => {
      this.readers.push({ resolve: resolveFrame, reject: rejectFrame });
    });
  }

  close(): void {
    this.stop();
    this.end(new Error('Python sandbox session closed'));
  }

  private accept(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size > MAX_FRAME_BYTES) {
        this.end(new Error(`Python sandbox frame exceeds ${MAX_FRAME_BYTES} bytes`));
        return;
      }
      if (this.buffer.length < size + 4) {
        return;
      }
      const payload = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      let frame: PythonFrame;
      try {
        frame = JSON.parse(payload.toString()) as PythonFrame;
      } catch (error) {
        this.end(
          new Error(
            `Python sandbox returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return;
      }
      const reader = this.readers.shift();
      if (reader) {
        reader.resolve(frame);
      } else {
        this.frames.push(frame);
      }
    }
  }

  private end(error: Error): void {
    if (this.endedError) {
      return;
    }
    this.endedError = error;
    for (const reader of this.readers.splice(0)) {
      reader.reject(error);
    }
  }
}

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = connect(path);
    socket.once('connect', () => resolveSocket(socket));
    socket.once('error', rejectSocket);
  });
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('error', rejectSpawn);
  });
}

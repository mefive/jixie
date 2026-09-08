import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PythonSession } from './session.js';

function packet(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

describe('Python session transport', () => {
  let directory: string;
  let server: Server;
  let session: PythonSession | undefined;
  const peers = new Set<Socket>();

  beforeEach(async () => {
    // Keep Unix socket paths below the platform limit even on macOS.
    directory = await mkdtemp('/tmp/jixie-python-');
    const socketPath = join(directory, 'test.sock');
    vi.stubEnv('JIXIE_PYTHON_LOCAL', '0');
    vi.stubEnv('JIXIE_SANDBOX_SOCKET', socketPath);
    server = createServer((peer) => {
      peers.add(peer);
      peer.on('error', () => {});
      peer.once('close', () => peers.delete(peer));
    });
    const listening = once(server, 'listening');
    server.listen(socketPath);
    await listening;
  });

  afterEach(async () => {
    session?.close();
    session = undefined;
    for (const peer of peers) {
      peer.destroy();
    }
    try {
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  async function connect(): Promise<Socket> {
    const connection = once(server, 'connection');
    session = await PythonSession.connect();
    const [peer] = await connection;
    return peer as Socket;
  }

  it('reassembles fragmented packets and keeps coalesced frames in order', async () => {
    const peer = await connect();
    const first = packet({ type: 'log', text: 'hello' });
    peer.write(first.subarray(0, 2));
    await new Promise<void>((resolve) => setImmediate(resolve));
    peer.write(Buffer.concat([first.subarray(2), packet({ type: 'done' })]));
    expect(await session!.read()).toEqual({ type: 'log', text: 'hello' });
    expect(await session!.read()).toEqual({ type: 'done' });
  });

  it('writes the existing length-prefixed JSON wire format', async () => {
    const peer = await connect();
    const frame = { type: 'init', code: 'print("hello")' };
    const expected = packet(frame);
    const received = new Promise<Buffer>((resolve) => {
      let buffer = Buffer.alloc(0);
      peer.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length >= expected.length) {
          resolve(buffer);
        }
      });
    });
    await session!.send(frame);
    expect(await received).toEqual(expected);
  });

  it.each([
    ['invalid JSON', Buffer.from([0, 0, 0, 1, 123]), 'returned invalid JSON'],
    ['missing type', packet({ value: 1 }), 'must be an object with a string type'],
    ['oversized frame', Buffer.from([4, 0, 0, 1]), 'frame exceeds 67108864 bytes'],
  ])('rejects %s and closes the transport', async (_name, bytes, message) => {
    const peer = await connect();
    const closed = once(peer, 'close');
    const rejected = expect(session!.read()).rejects.toThrow(message);
    peer.write(bytes);
    await rejected;
    await closed;
  });

  it('aborts a schema-invalid frame and rejects every waiting reader', async () => {
    const peer = await connect();
    const rejected = expect(
      session!.readValidated(z.strictObject({ type: z.literal('ready') }), 'starting test'),
    ).rejects.toThrow('invalid Python sandbox protocol while starting test');
    const pending = expect(session!.read()).rejects.toThrow('invalid Python sandbox protocol');
    peer.write(packet({ type: 'ready', unexpected: true }));
    await Promise.all([rejected, pending]);
  });

  it('rejects pending reads when the peer disconnects', async () => {
    const peer = await connect();
    const rejected = expect(session!.read()).rejects.toThrow('closed the protocol');
    peer.end();
    await rejected;
  });

  it('cancels pending reads and closes the peer on explicit close', async () => {
    const peer = await connect();
    const closed = once(peer, 'close');
    const rejected = expect(session!.read()).rejects.toThrow('session closed');
    session!.close();
    await rejected;
    await closed;
  });

  it('forbids the local Python branch in production before spawning', async () => {
    vi.stubEnv('JIXIE_PYTHON_LOCAL', '1');
    vi.stubEnv('NODE_ENV', 'production');
    await expect(PythonSession.connect()).rejects.toThrow('forbidden in production');
    expect(peers.size).toBe(0);
  });
});

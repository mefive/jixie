const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export function encodeFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length > MAX_FRAME_BYTES) {
    throw new Error(`sandbox frame exceeds ${MAX_FRAME_BYTES} bytes`);
  }

  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

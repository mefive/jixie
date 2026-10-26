import { Hono } from 'hono';
import { readResearchArtifact } from '../outputs/read-artifact.js';

export const researchArtifactRoute = new Hono();

researchArtifactRoute.get('/artifacts/:artifactId', async (c) => {
  const artifact = await readResearchArtifact(c.var.userId, c.req.param('artifactId'));

  const etag = `"${artifact.sha256}"`;
  // 浏览器切换账户时仍须重新校验归属。
  // Revalidate ownership before reuse because one browser profile can switch accounts.
  c.header('Cache-Control', 'private, no-cache');
  c.header('ETag', etag);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "sandbox; default-src 'none'");
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304);
  }
  c.header('Content-Type', artifact.mimeType);
  c.header('Content-Length', String(artifact.byteSize));
  return c.body(new Uint8Array(artifact.data));
});

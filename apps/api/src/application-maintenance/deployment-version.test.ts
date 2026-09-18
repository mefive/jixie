import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getDeploymentVersion } from './deployment-version.js';
import { maintenanceRoute } from './routes.js';

vi.mock('./state.js', () => ({ getMaintenanceStatus: vi.fn() }));

describe('successful deployment version', () => {
  let directory: string;
  let revisionFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jixie-deployment-version-'));
    revisionFile = join(directory, 'deployed-revision');
    vi.stubEnv('JIXIE_DEPLOYED_REVISION_FILE', revisionFile);
    vi.stubEnv('JIXIE_APP_REVISION', 'f'.repeat(40));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('does not substitute the deployment target for a missing success record', async () => {
    expect(await getDeploymentVersion()).toEqual({ revision: null });
    vi.stubEnv('JIXIE_DEPLOYED_REVISION_FILE', '');
    expect(await getDeploymentVersion()).toEqual({ revision: null });
  });

  it('reads an atomic marker update without restarting the API and disables caching', async () => {
    const app = new Hono().route('/api/maintenance', maintenanceRoute);
    const previousRevision = 'a'.repeat(40);
    const nextRevision = 'b'.repeat(40);
    await writeFile(revisionFile, `${previousRevision}\n`);

    const previousResponse = await app.request('/api/maintenance/version');
    expect(previousResponse.status).toBe(200);
    expect(previousResponse.headers.get('Cache-Control')).toBe('no-store');
    expect(await previousResponse.json()).toEqual({ revision: previousRevision });

    await writeFile(`${revisionFile}.tmp`, `${nextRevision}\n`);
    expect(await getDeploymentVersion()).toEqual({ revision: previousRevision });
    await rename(`${revisionFile}.tmp`, revisionFile);

    const nextResponse = await app.request('/api/maintenance/version');
    expect(await nextResponse.json()).toEqual({ revision: nextRevision });
  });

  it('accepts full SHA-256 revisions as well as SHA-1', async () => {
    const revision = 'c'.repeat(64);
    await writeFile(revisionFile, `${revision}\n`);
    expect(await getDeploymentVersion()).toEqual({ revision });
  });

  it('does not expose malformed file contents or a filesystem failure to the browser', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(revisionFile, 'unexpected file contents');
    expect(await getDeploymentVersion()).toEqual({ revision: null });
    vi.stubEnv('JIXIE_DEPLOYED_REVISION_FILE', directory);
    expect(await getDeploymentVersion()).toEqual({ revision: null });
    expect(warning).toHaveBeenCalledTimes(2);
  });
});

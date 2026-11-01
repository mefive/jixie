import { readFile } from 'node:fs/promises';

/**
 * 读取最近成功部署的版本信息，支持不重启 API 的部署更新。
 *
 * Read the last successful deployment, including updates made without restarting the API.
 */
export async function getDeploymentVersion(): Promise<{ revision: string | null }> {
  const revisionFile = process.env.JIXIE_DEPLOYED_REVISION_FILE;
  if (!revisionFile) {
    return { revision: null };
  }

  try {
    const revision = (await readFile(revisionFile, 'utf8')).trim();
    if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) {
      return { revision };
    }
    console.warn('Invalid successful deployment revision');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Unable to read successful deployment revision');
    }
  }
  return { revision: null };
}

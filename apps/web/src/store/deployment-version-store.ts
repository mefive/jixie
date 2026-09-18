import { fetchDeploymentVersion, type DeploymentVersion } from '@src/api/maintenance';
import { LoaderModel } from '@src/lib';

class DeploymentVersionStore {
  public loader = new LoaderModel<DeploymentVersion>();

  public constructor() {
    this.loader.setup({ request: (_, signal) => fetchDeploymentVersion(signal) });
  }

  public async load(): Promise<void> {
    await this.loader.run().catch(() => {});
  }
}

export const deploymentVersionStore = new DeploymentVersionStore();

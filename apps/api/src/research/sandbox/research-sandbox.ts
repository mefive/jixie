import { Sandbox } from '#infra/sandbox/sandbox.js';
import { ResearchPythonInterruptionError } from '../errors.js';
import type { ResearchPythonAnalysis } from './host/analysis-types.js';
import { ResearchBridge } from './research-bridge.js';
import type {
  ResearchCellInput,
  ResearchBridgeContract,
  ResearchCellRunInput,
  ResearchCellRunOptions,
  ResearchCellRunResult,
  ResearchSandboxMetadata,
  ResearchStartOptions,
} from './contract.js';

export class ResearchSandbox extends Sandbox<
  ResearchCellRunInput,
  ResearchCellRunResult,
  ResearchSandboxMetadata,
  ResearchCellRunOptions,
  ResearchBridgeContract
> {
  activeCellId?: string;
  interrupted = false;

  private constructor(private readonly documentId: string) {
    super();
  }

  static async start({ documentId, signal }: ResearchStartOptions): Promise<ResearchSandbox> {
    const sandbox = new ResearchSandbox(documentId);
    await sandbox.initialize({ signal, abortMessage: 'Research startup aborted' });

    return sandbox;
  }

  protected createBridge(signal?: AbortSignal): Promise<ResearchBridgeContract> {
    return ResearchBridge.create({ documentId: this.documentId, signal }, this);
  }

  async analyze(cells: ResearchCellInput[]): Promise<ResearchPythonAnalysis[]> {
    this.assertOpen();

    return this.bridge.analyze(cells);
  }

  protected async executeInSandbox(
    input: ResearchCellRunInput,
    options: ResearchCellRunOptions = {},
  ): Promise<ResearchCellRunResult> {
    this.activeCellId = input.cell.id;
    try {
      return await this.bridge.execute(input, options);
    } catch (error) {
      if (this.interrupted) {
        throw new ResearchPythonInterruptionError();
      }
      throw error;
    } finally {
      this.activeCellId = undefined;
    }
  }

  async reset(): Promise<void> {
    this.assertOpen();

    await this.bridge.reset();
  }

  interrupt(): void {
    this.interrupted = true;
    this.abort(new Error('Research execution interrupted'));
  }
}

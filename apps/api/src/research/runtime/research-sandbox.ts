import { Sandbox } from '#infra/runtime/sandbox.js';
import { ResearchPythonInterruptionError } from '../errors.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';
import type { ResearchPythonAnalysis } from './host/analysis-types.js';
import { ResearchBridge } from './research-bridge.js';
import type {
  ResearchCellInput,
  ResearchBridgeContract,
  ResearchExecutionInput,
  ResearchExecutionOptions,
  ResearchExecution,
  ResearchSandboxMetadata,
  ResearchStartOptions,
} from './contract.js';

export class ResearchSandbox extends Sandbox<
  ResearchExecutionInput,
  ResearchExecution,
  ResearchSandboxMetadata,
  ResearchExecutionOptions,
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
    input: ResearchExecutionInput,
    options: ResearchExecutionOptions = {},
  ): Promise<ResearchExecution> {
    this.activeCellId = input.cell.id;
    try {
      return await this.bridge.execute(input, options);
    } catch (error) {
      if (this.interrupted) {
        throw new ResearchPythonInterruptionError(researchPayloadHash(this.metadata.environment));
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

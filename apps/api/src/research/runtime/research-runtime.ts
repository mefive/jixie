import { SandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import { ResearchPythonInterruptionError } from '../errors.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';
import type { ResearchPythonAnalysis } from './host/analysis-types.js';
import { ResearchBridge } from './bridge.js';
import type {
  ResearchCellInput,
  ResearchBridgeContract,
  ResearchExecutionInput,
  ResearchExecutionOptions,
  ResearchExecution,
  ResearchRuntimeMetadata,
  ResearchStartOptions,
} from './contract.js';

export class ResearchRuntime extends SandboxRuntime<
  ResearchExecutionInput,
  ResearchExecution,
  ResearchRuntimeMetadata,
  ResearchExecutionOptions,
  ResearchBridgeContract
> {
  activeCellId?: string;
  interrupted = false;

  private constructor(private readonly documentId: string) {
    super();
  }

  static async start({ documentId, signal }: ResearchStartOptions): Promise<ResearchRuntime> {
    const runtime = new ResearchRuntime(documentId);
    await runtime.initialize({ signal, abortMessage: 'Research startup aborted' });

    return runtime;
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

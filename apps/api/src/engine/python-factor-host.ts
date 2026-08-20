import type { UserLogSink } from '../lib/sandbox-console.js';
import { compilePythonCrossSectionalFactor } from '../factor/python-cross-sectional-runtime.js';
import {
  compilePythonPanelFactor,
  compilePythonTimeSeriesFactor,
} from '../factor/python-asset-factor-runtime.js';
import type { CompiledFactor } from '../factor/compile-factor.js';
import type {
  CompiledPanelFactor,
  CompiledTimeSeriesFactor,
} from '../factor/compile-time-series-factor.js';
import type { EngineDataPort, PythonFactorComputeRequest } from './data-port.js';

type CompiledPythonFactor = CompiledFactor | CompiledTimeSeriesFactor | CompiledPanelFactor;

/** Owns Python Factor sessions for one engine run and keeps them outside the JS isolate wall. */
export class PythonFactorHost {
  private readonly factors = new Map<
    string,
    {
      code: string;
      analysisKind: PythonFactorComputeRequest['analysisKind'];
      compiled: CompiledPythonFactor;
    }
  >();

  constructor(private readonly onUserLog?: UserLogSink) {}

  async compute(request: PythonFactorComputeRequest): Promise<(number | null)[]> {
    const compiled = await this.factor(request);
    if (request.analysisKind === 'cross_sectional') {
      if (!('computeBatch' in compiled) || !request.crossSectionalItems) {
        throw new Error('Python cross-sectional Factor request is incomplete');
      }
      return compiled.computeBatch(request.crossSectionalItems);
    }
    if (!('computeSeries' in compiled) || !request.fields || !request.indexes) {
      throw new Error('Python asset Factor request is incomplete');
    }
    return compiled.computeSeries(request.fields, request.indexes);
  }

  close(): void {
    for (const factor of this.factors.values()) {
      factor.compiled.dispose();
    }
    this.factors.clear();
  }

  private async factor(request: PythonFactorComputeRequest): Promise<CompiledPythonFactor> {
    const existing = this.factors.get(request.factorKey);
    if (existing) {
      if (existing.code !== request.code || existing.analysisKind !== request.analysisKind) {
        throw new Error(`Python Factor ${request.factorKey} changed during one engine run`);
      }
      return existing.compiled;
    }
    const compiled =
      request.analysisKind === 'cross_sectional'
        ? await compilePythonCrossSectionalFactor(request.code, this.onUserLog)
        : request.analysisKind === 'time_series'
          ? await compilePythonTimeSeriesFactor(request.code, this.onUserLog)
          : await compilePythonPanelFactor(request.code, this.onUserLog);
    this.factors.set(request.factorKey, {
      code: request.code,
      analysisKind: request.analysisKind,
      compiled,
    });
    return compiled;
  }
}

export function withPythonFactorHost(port: EngineDataPort, host: PythonFactorHost): EngineDataPort {
  return new Proxy(port, {
    get(target, property, receiver) {
      if (property === 'pythonFactorCompute') {
        return (request: PythonFactorComputeRequest) => host.compute(request);
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

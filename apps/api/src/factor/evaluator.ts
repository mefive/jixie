import type {
  CrossSectionalFactorResearchSpecV1,
  FactorReport,
  FactorResearchSpecV1,
  Locale,
} from '@jixie/shared';
import type { UserLogSink } from '../lib/sandbox-console.js';
import { analyzeFactor } from './analysis.js';
import type { FactorAnalysisRuntimeSource } from './composite.js';

export interface CrossSectionalEvaluationRequest {
  factor: string;
  researchSpec: CrossSectionalFactorResearchSpecV1;
  source: FactorAnalysisRuntimeSource;
  locale: Locale;
  onSystemLog: (text: string) => void;
  onUserLog: UserLogSink;
}

type CrossSectionalAnalyze = typeof analyzeFactor;

/** Adapter around the production equity evaluator. Keeping this boundary numeric-free guarantees the
 * registry migration cannot alter a legacy report while later evaluators get separate implementations. */
export class CrossSectionalEvaluator {
  public readonly analysisKind = 'cross_sectional' as const;

  public constructor(private readonly analyze: CrossSectionalAnalyze = analyzeFactor) {}

  public evaluate(request: CrossSectionalEvaluationRequest): Promise<FactorReport> {
    return this.analyze(
      request.factor,
      request.researchSpec.protocol,
      request.onSystemLog,
      request.onUserLog,
      request.locale,
      request.source,
    );
  }
}

export function factorEvaluatorFor(researchSpec: FactorResearchSpecV1): CrossSectionalEvaluator {
  switch (researchSpec.analysisKind) {
    case 'cross_sectional':
      return new CrossSectionalEvaluator();
    case 'time_series':
    case 'panel':
    case 'macro_regime':
      throw new Error(`Factor evaluator ${researchSpec.analysisKind} is not implemented.`);
  }
}

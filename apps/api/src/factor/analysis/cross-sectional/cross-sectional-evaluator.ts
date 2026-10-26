import type {
  CrossSectionalFactorResearchSpecV1,
  FactorReport,
  FactorResearchSpecV1,
  Locale,
} from '@jixie/shared';
import type { UserLogSink } from '#infra/sandbox/console.js';
import { analyzeFactor } from './evaluate.js';
import type { FactorAnalysisRuntimeSource } from '../../sources/snapshot.js';

/**
 * 描述单次截面求值的因子来源、日期和输入，供统一求值器。
 *
 * Describe a cross-sectional source, date and inputs for shared factor evaluation.
 */
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

/**
 * 为当前截面评估选择已准备的因子求值实现，统一预置与作者因子计算路径。
 *
 * Select the prepared factor evaluator for a cross-sectional request.
 */
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

import type {
  CrossSectionalFactorCapabilities,
  AssetFactorCapabilities,
} from '../../sdk/capabilities.js';
import type { SdkAdapter } from '#infra/runtime/sdk-adapter.js';
import type { FactorHistory, AssetFactorExecutionInput } from '../contract.js';

interface CrossSectionalFactorAdapterInput {
  kind: 'cross_sectional';
  history: FactorHistory;
}

interface AssetFactorAdapterInput {
  kind: 'asset';
  fields: AssetFactorExecutionInput['fields'];
  index: number;
  declaredInputs: ReadonlySet<string>;
}

type FactorAdapterInput = CrossSectionalFactorAdapterInput | AssetFactorAdapterInput;
type FactorCapabilities = CrossSectionalFactorCapabilities | AssetFactorCapabilities;

/** Bind prepared data to SDK primitives without introducing host requests. */
export class FactorAdapter implements SdkAdapter<FactorAdapterInput, FactorCapabilities> {
  bind(input: CrossSectionalFactorAdapterInput): CrossSectionalFactorCapabilities;
  bind(input: AssetFactorAdapterInput): AssetFactorCapabilities;
  bind(input: FactorAdapterInput): FactorCapabilities;
  bind(input: FactorAdapterInput): FactorCapabilities {
    if (input.kind === 'cross_sectional') {
      return new BoundCrossSectionalFactorCapabilities(input.history);
    }

    return new BoundAssetFactorCapabilities(input.fields, input.index, input.declaredInputs);
  }
}

class BoundCrossSectionalFactorCapabilities implements CrossSectionalFactorCapabilities {
  constructor(private readonly history: FactorHistory) {}

  get hasHistory(): boolean {
    return this.history.closes != null;
  }

  historyValues(field?: string) {
    switch (field) {
      case 'date':
        return this.history.dates;
      case 'amount':
        return this.history.amounts;
      case 'turnoverRateF':
        return this.history.turnoverRatesF;
      case 'roe':
        return this.history.roes;
      case 'grossprofitMargin':
        return this.history.grossProfitMargins;
      case 'marketClose':
        return this.history.marketCloses;
      default:
        return this.history.closes;
    }
  }
}

class BoundAssetFactorCapabilities implements AssetFactorCapabilities {
  constructor(
    private readonly fields: AssetFactorExecutionInput['fields'],
    private readonly index: number,
    private readonly declaredInputs: ReadonlySet<string>,
  ) {}

  declaresInput(field: string): boolean {
    return this.declaredInputs.has(field);
  }

  valueAt(field: string, periods: number): number | undefined {
    const values = this.fields[field as keyof typeof this.fields];

    return values && values[this.index - periods];
  }
}

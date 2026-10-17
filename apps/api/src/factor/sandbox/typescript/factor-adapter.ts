import type {
  CrossSectionalFactorCapabilities,
  AssetFactorCapabilities,
} from '../../sdk/capabilities.js';
import type { SdkAdapter } from '#infra/sandbox/sdk-adapter.js';
import type { FactorHistory, AssetFactorComputeInput } from '../contract.js';

/**
 * 绑定截面输入、索引与声明字段，供 SDK 原始能力读取。
 *
 * Bind cross-sectional inputs, indexes and declared fields for SDK capabilities.
 */
interface CrossSectionalFactorAdapterInput {
  kind: 'cross_sectional';
  history: FactorHistory;
}

/**
 * 绑定资产序列与历史窗口，供 SDK 原始能力读取。
 *
 * Bind asset series and history windows for SDK capabilities.
 */
interface AssetFactorAdapterInput {
  kind: 'asset';
  fields: AssetFactorComputeInput['fields'];
  index: number;
  declaredInputs: ReadonlySet<string>;
}

/**
 * 区分截面与资产适配输入，供按因子种类绑定。
 *
 * Discriminate cross-sectional and asset adapter inputs for capability binding.
 */
type FactorAdapterInput = CrossSectionalFactorAdapterInput | AssetFactorAdapterInput;

/**
 * 统一因子 SDK 原始能力联合，保留按种类访问约束。
 *
 * Unify kind-specific factor SDK capabilities while retaining access constraints.
 */
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

  /**
   * 从当前能力绑定读取历史字段，并遵守其声明范围和索引。
   *
   * Read declared history fields from the current capability binding and indexes.
   */
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
    private readonly fields: AssetFactorComputeInput['fields'],
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

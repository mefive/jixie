import { PythonCrossSectionalFactorRuntime } from './python/python-cross-sectional-factor-runtime.js';
import { PythonAssetFactorRuntime } from './python/python-asset-factor-runtime.js';
import {
  TypeScriptCrossSectionalFactorRuntime,
  TypeScriptAssetFactorRuntime,
} from './typescript/typescript-factor-runtime.js';
import type {
  FactorStartOptions,
  CrossSectionalFactorRuntime,
  AssetFactorKind,
  AssetFactorRuntime,
  FactorRuntimeInstance,
} from './contract.js';

/** The only language/kind selection boundary for executable Factor instances. */
export class FactorRuntime {
  static start(
    options: FactorStartOptions<'cross_sectional'>,
  ): Promise<CrossSectionalFactorRuntime>;
  static start<Kind extends AssetFactorKind>(
    options: FactorStartOptions<Kind>,
  ): Promise<AssetFactorRuntime<Kind>>;
  static start(options: FactorStartOptions): Promise<FactorRuntimeInstance>;
  static start(options: FactorStartOptions): Promise<FactorRuntimeInstance> {
    switch (options.analysisKind) {
      case 'cross_sectional':
        return options.language === 'python'
          ? PythonCrossSectionalFactorRuntime.start({ ...options, analysisKind: 'cross_sectional' })
          : TypeScriptCrossSectionalFactorRuntime.start({
              ...options,
              analysisKind: 'cross_sectional',
            });
      case 'time_series':
        return options.language === 'python'
          ? PythonAssetFactorRuntime.start({ ...options, analysisKind: 'time_series' })
          : TypeScriptAssetFactorRuntime.start({ ...options, analysisKind: 'time_series' });
      case 'panel':
        return options.language === 'python'
          ? PythonAssetFactorRuntime.start({ ...options, analysisKind: 'panel' })
          : TypeScriptAssetFactorRuntime.start({ ...options, analysisKind: 'panel' });
    }
  }
}

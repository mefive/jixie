import { describe, expect, it } from 'vitest';
import {
  pythonFactorTargetAssetClasses,
  validatePythonFactorDefinition,
} from './python-factor-validator.js';

const crossSectionalFactor = `from jixie import Factor, FactorBar, CrossSectionalFactorContext

factor = Factor.cross_sectional(name="20-day momentum", window=21, min_coverage=0.8)

@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    closes = ctx.history(21)
    if len(closes) < 21 or closes[0] <= 0:
        return None
    return closes[-1] / closes[0] - 1
`;
const panelFactor = `from jixie import Factor, AssetFactorContext

factor = Factor.panel(
    name="stock-bond momentum",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income"],
    window=121,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    return ctx.value("etf.adjustedClose")
`;

describe('Python Factor static validator', () => {
  it('accepts a typed cross-sectional Factor without executing it', async () => {
    await expect(
      validatePythonFactorDefinition(crossSectionalFactor, 'cross_sectional'),
    ).resolves.toBeUndefined();
  }, 20_000);

  it('rejects a source whose factory does not match the immutable analysis kind', async () => {
    await expect(validatePythonFactorDefinition(crossSectionalFactor, 'panel')).rejects.toThrow(
      'does not match panel',
    );
  });

  it('requires one explicit compute callback', async () => {
    await expect(
      validatePythonFactorDefinition(
        'from jixie import Factor\nfactor = Factor.cross_sectional(name="x")\n',
        'cross_sectional',
      ),
    ).rejects.toThrow('@factor.compute');
  });

  it('reads an asset Factor domain statically without executing Python', () => {
    expect(pythonFactorTargetAssetClasses(panelFactor)).toEqual(['equity', 'fixed_income']);
    expect(() =>
      pythonFactorTargetAssetClasses(
        panelFactor.replace('["equity", "fixed_income"]', 'ASSET_CLASSES'),
      ),
    ).toThrow('literal target_asset_classes');
  });

  it('rejects non-literal and duplicate asset-domain declarations', async () => {
    await expect(
      validatePythonFactorDefinition(
        panelFactor.replace('["equity", "fixed_income"]', '["equity", "equity"]'),
        'panel',
      ),
    ).rejects.toThrow('unique supported classes');
  });

  it('surfaces Pyright type errors against the generated SDK contract', async () => {
    await expect(
      validatePythonFactorDefinition(
        crossSectionalFactor.replace('ctx.history(21)', 'ctx.history("twenty")'),
        'cross_sectional',
      ),
    ).rejects.toThrow('cannot be assigned');
  }, 20_000);
});

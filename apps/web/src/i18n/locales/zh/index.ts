import { zhEmbedded } from './embedded';
import { zhCommon } from './common';
import { zhLogin } from './login';
import { zhComponents } from './components';
import { zhStrategy } from './strategy';
import { zhFactor } from './factor';
import { zhFactorWeather } from './factor-weather';
import { zhStock } from './stock';
import { zhValuation } from './valuation';
import { zhSignals } from './signals';
import { zhLibrary } from './library';
import { zhResearch } from './research';

// Chinese resource bundle, keyed by namespace. Add a namespace here when a page is internationalized.
export const zhResources = {
  embedded: zhEmbedded,
  common: zhCommon,
  login: zhLogin,
  components: zhComponents,
  strategy: zhStrategy,
  factor: zhFactor,
  factorWeather: zhFactorWeather,
  stock: zhStock,
  valuation: zhValuation,
  signals: zhSignals,
  library: zhLibrary,
  research: zhResearch,
};

export const RESEARCH_PYTHON_RUNTIME_CATALOG_QUERY_V1 = 'runtime.python' as const;

export const RESEARCH_PYTHON_RUNTIME_PACKAGES_V1 = [
  {
    distribution: 'numpy',
    version: '2.3.2',
    importNames: ['numpy'],
    preloadedAlias: 'np',
    purpose: 'Array computing, linear algebra, vectorized numerical transforms, and simulation.',
    policy: 'Use for numerical primitives; do not reimplement array or linear-algebra kernels.',
  },
  {
    distribution: 'pandas',
    version: '2.3.1',
    importNames: ['pandas'],
    preloadedAlias: 'pd',
    purpose:
      'Tabular data preparation, joins, grouping, rolling windows, and time-series alignment.',
    policy: 'Use for DataFrame transformations and explicit date alignment.',
  },
  {
    distribution: 'scipy',
    version: '1.18.0',
    importNames: ['scipy'],
    purpose:
      'Probability distributions, hypothesis tests, optimization, signal processing, and scientific routines.',
    policy:
      'Use SciPy distributions and tests instead of implementing p-values or numerical solvers by hand.',
  },
  {
    distribution: 'statsmodels',
    version: '0.14.6',
    importNames: ['statsmodels'],
    purpose:
      'OLS, GLM, HAC covariance, time-series models, stationarity tests, and regression diagnostics.',
    policy:
      'Use statsmodels estimators and diagnostics instead of hand-written regression or HAC implementations.',
  },
  {
    distribution: 'matplotlib',
    version: '3.10.5',
    importNames: ['matplotlib'],
    purpose: 'Custom static figures and compatibility with statistical plotting helpers.',
    policy:
      'Prefer charts.* for standard interactive output; use Matplotlib only when native charts cannot express the figure.',
  },
  {
    distribution: 'scikit-learn',
    version: '1.9.0',
    importNames: ['sklearn'],
    purpose:
      'Preprocessing, model selection, covariance estimators, and classical machine-learning workflows.',
    policy: 'Use only with prespecified validation and explicit leakage controls.',
  },
] as const;

export const RESEARCH_PYTHON_SAFE_STANDARD_LIBRARY_IMPORTS_V1 = [
  'calendar',
  'collections',
  'dataclasses',
  'datetime',
  'decimal',
  'enum',
  'fractions',
  'functools',
  'itertools',
  'json',
  'math',
  'operator',
  're',
  'statistics',
  'typing',
  'warnings',
] as const;

export const RESEARCH_PYTHON_RUNTIME_CAPABILITIES_V1 = {
  version: 1,
  runtime: 'research-py-v1',
  python: '3.13',
  catalogQuery: RESEARCH_PYTHON_RUNTIME_CATALOG_QUERY_V1,
  packages: RESEARCH_PYTHON_RUNTIME_PACKAGES_V1,
  safeStandardLibraryImports: RESEARCH_PYTHON_SAFE_STANDARD_LIBRARY_IMPORTS_V1,
  outputPolicy: {
    interactive: 'Use charts.* for standard line, scatter, bar, histogram, and heatmap outputs.',
    static:
      'Use Matplotlib with the Agg backend only for custom figures that charts.* cannot express. The fixed runtime currently provides DejaVu Sans but no CJK font, so keep Matplotlib-rendered titles, axis labels, legends, and annotations in concise English; Chinese remains valid in Markdown and console text.',
  },
  generationRules: [
    'Import only packages and safe standard-library modules listed in this capability contract.',
    'Do not install packages at runtime.',
    'Do not reimplement an estimator, statistical distribution, hypothesis test, covariance estimator, optimizer, or plotting primitive already supplied by the fixed runtime.',
    'State a capability gap instead of inventing a substitute for an unavailable package.',
  ],
} as const;

export function renderResearchPythonRuntimeRequirements(): string {
  return [
    '# Generated from packages/shared/src/research-python-runtime.ts.',
    '# Run pnpm gen:research-runtime after changing the capability contract.',
    ...RESEARCH_PYTHON_RUNTIME_PACKAGES_V1.map(
      ({ distribution, version }) => `${distribution}==${version}`,
    ),
    '',
  ].join('\n');
}

export function researchPythonAllowedImportRoots(): ReadonlySet<string> {
  return new Set([
    ...RESEARCH_PYTHON_RUNTIME_PACKAGES_V1.flatMap((item) => item.importNames),
    ...RESEARCH_PYTHON_SAFE_STANDARD_LIBRARY_IMPORTS_V1,
  ]);
}

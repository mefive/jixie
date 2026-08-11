import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ACCEPTANCE = new URL('../acceptance/', import.meta.url).pathname;
const DOCS_IMAGES = new URL('../../docs/public/images/help/zh/', import.meta.url).pathname;

const red = '#e8463b';
const annotationFont = [
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].find(existsSync);

mkdirSync(`${DOCS_IMAGES}backtesting`, { recursive: true });
mkdirSync(`${DOCS_IMAGES}factors`, { recursive: true });
mkdirSync(`${DOCS_IMAGES}signals`, { recursive: true });

const jobs = [
  {
    source: 'python-history-e2e.png',
    output: 'backtesting/python-strategy-01.png',
    marks: [
      [1, 390, 54, 540, 92],
      [2, 392, 94, 909, 664],
      [3, 1310, 54, 1435, 96],
    ],
  },
  {
    source: 'python-history-e2e.png',
    output: 'backtesting/python-strategy-02.png',
    marks: [
      [1, 922, 100, 1430, 600],
      [2, 392, 667, 909, 892],
    ],
  },
  {
    source: '7p-factor-evaluation-scope-settings.png',
    output: 'factors/evaluation-scope-01.png',
    marks: [
      [1, 1058, 383, 1421, 459],
      [2, 1058, 461, 1421, 538],
      [3, 1058, 540, 1421, 626],
      [4, 1058, 626, 1421, 763],
    ],
  },
  {
    source: '7q-factor-evaluation-scope-report.png',
    output: 'factors/evaluation-scope-02.png',
    marks: [
      [1, 905, 177, 1425, 611],
      [2, 905, 628, 1425, 996],
    ],
  },
  {
    source: '7r-factor-publication.png',
    output: 'factors/publish-factor-01.png',
    marks: [
      [1, 351, 54, 890, 96],
      [2, 905, 580, 1425, 682],
    ],
  },
  {
    source: '7s-factor-archived.png',
    output: 'factors/publish-factor-02.png',
    marks: [
      [1, 351, 54, 890, 96],
      [2, 905, 580, 1425, 682],
    ],
  },
  {
    source: '9a-factor-time-series-config.jpg',
    output: 'factors/time-series-research-01.png',
    marks: [
      [1, 889, 148, 1268, 271],
      [2, 889, 293, 1268, 359],
      [3, 889, 367, 1268, 440],
      [4, 1157, 527, 1266, 570],
    ],
  },
  {
    source: '9b-factor-time-series-report.jpg',
    output: 'factors/time-series-research-02.png',
    marks: [
      [1, 824, 180, 1265, 362],
      [2, 824, 414, 1265, 714],
    ],
  },
  {
    source: 'factor-panel-report.png',
    output: 'factors/panel-research-01.png',
    marks: [
      [1, 339, 56, 888, 96],
      [2, 905, 140, 1427, 432],
      [3, 905, 444, 1427, 995],
    ],
  },
  {
    source: 'factor-panel-normalization.png',
    crop: '540x1000+900+0',
    output: 'factors/panel-research-02.png',
    marks: [
      [1, 4, 268, 526, 489],
      [2, 4, 516, 526, 998],
    ],
  },
  {
    source: 'macro-regime-report.png',
    output: 'factors/macro-regime-01.png',
    marks: [
      [1, 338, 55, 808, 117],
      [2, 338, 117, 808, 535],
      [3, 810, 134, 1250, 283],
    ],
  },
  {
    source: 'macro-regime-report.png',
    crop: '470x650+810+60',
    output: 'factors/macro-regime-02.png',
    marks: [
      [1, 12, 72, 440, 225],
      [2, 12, 235, 440, 550],
    ],
  },
  {
    source: 'factor-panel-composite-attribution.png',
    output: 'backtesting/allocation-attribution-01.png',
    marks: [
      [1, 14, 68, 489, 126],
      [2, 14, 128, 489, 165],
      [3, 14, 172, 489, 422],
    ],
  },
  {
    sources: ['factor-panel-composite-correlation.png', 'factor-panel-composite-rate-regime.png'],
    append: true,
    output: 'backtesting/allocation-attribution-02.png',
    marks: [
      [1, 14, 177, 489, 344],
      [2, 80, 426, 475, 656],
      [3, 14, 1143, 489, 1312],
      [4, 14, 1408, 489, 1848],
    ],
  },
  {
    source: 'phase5-market-risk.png',
    output: 'backtesting/portfolio-risk-01.png',
    marks: [
      [1, 2, 2, 470, 143],
      [2, 2, 188, 470, 711],
    ],
  },
  {
    sources: ['phase5-macro-risk-warning.png', 'phase5-risk-scenarios.png'],
    append: true,
    output: 'backtesting/portfolio-risk-02.png',
    marks: [
      [1, 2, 2, 470, 162],
      [2, 2, 198, 470, 751],
      [3, 2, 938, 470, 1734],
    ],
  },
  {
    source: '12b-cgb-signal-factor-inputs.png',
    crop: '1000x620+390+370',
    output: 'signals/factor-inputs-01.png',
    marks: [
      [1, 12, 430, 990, 615],
      [2, 365, 510, 535, 610],
      [3, 535, 510, 705, 610],
      [4, 705, 510, 990, 610],
    ],
  },
];

for (const job of jobs) {
  render(job);
}

console.log(`[help-content-latest] PASS ${jobs.length} annotated screenshots`);

function render(job) {
  const sourceNames = job.sources ?? [job.source];
  const args = sourceNames.map((source) => `${ACCEPTANCE}${source}`);
  if (job.append) {
    args.push('-append');
  }
  if (job.crop) {
    args.push('-crop', job.crop, '+repage');
  }
  if (annotationFont) {
    args.push('-font', annotationFont);
  }
  for (const [number, x1, y1, x2, y2] of job.marks) {
    const badgeX = Math.max(18, x1 + 2);
    const badgeY = Math.max(18, y1 + 2);
    args.push(
      '-fill',
      'none',
      '-stroke',
      red,
      '-strokewidth',
      '4',
      '-draw',
      `roundrectangle ${x1},${y1} ${x2},${y2} 10,10`,
      '-fill',
      red,
      '-stroke',
      'white',
      '-strokewidth',
      '2',
      '-draw',
      `circle ${badgeX},${badgeY} ${badgeX + 17},${badgeY}`,
      '-fill',
      'white',
      '-stroke',
      'none',
      ...(annotationFont
        ? ['-pointsize', '20', '-draw', `text ${badgeX - 6},${badgeY + 7} '${number}'`]
        : ['-stroke', 'white', '-strokewidth', '3', '-draw', digitPath(number, badgeX, badgeY)]),
    );
  }

  const output = `${DOCS_IMAGES}${job.output}`;
  args.push('-strip', output);
  const result = spawnSync('/opt/homebrew/bin/magick', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`failed to create ${job.output}: ${result.stderr || result.stdout}`);
  }
}

function digitPath(number, x, y) {
  const paths = {
    1: `path 'M ${x},${y - 8} L ${x},${y + 8}'`,
    2: `path 'M ${x - 6},${y - 6} L ${x + 6},${y - 6} L ${x + 6},${y} L ${x - 6},${y + 7} L ${x + 6},${y + 7}'`,
    3: `path 'M ${x - 6},${y - 7} L ${x + 6},${y - 7} L ${x},${y} L ${x + 6},${y} L ${x},${y} L ${x + 6},${y + 7} L ${x - 6},${y + 7}'`,
    4: `path 'M ${x - 6},${y - 7} L ${x - 6},${y} L ${x + 6},${y} M ${x + 5},${y - 8} L ${x + 5},${y + 8}'`,
  };
  return paths[number];
}

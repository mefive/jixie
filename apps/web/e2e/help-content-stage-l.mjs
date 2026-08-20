import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ACCEPTANCE = new URL('../acceptance/', import.meta.url).pathname;
const DOCS_IMAGES = new URL('../../docs/public/images/help/zh/', import.meta.url).pathname;
const red = '#e8463b';
const annotationFont = [
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].find(existsSync);

for (const directory of ['research', 'factors', 'library', 'backtesting']) {
  mkdirSync(`${DOCS_IMAGES}${directory}`, { recursive: true });
}

const jobs = [
  {
    source: 'research-workbench-landing.png',
    output: 'research/document-cells-01.png',
    redact: [[1028, 10, 1182, 43]],
    marks: [
      [1, 12, 115, 235, 150],
      [2, 379, 401, 811, 613],
      [3, 828, 401, 1147, 613],
    ],
  },
  {
    source: 'research-workbench-document.png',
    output: 'research/document-cells-02.png',
    redact: [[1032, 10, 1180, 43]],
    marks: [
      [1, 285, 135, 864, 321],
      [2, 285, 389, 864, 664],
      [3, 900, 55, 1277, 716],
    ],
  },
  {
    source: 'research-sdk-static-schema-completion.jpg',
    output: 'research/data-catalog-01.png',
    redact: [[1038, 10, 1180, 43]],
    marks: [
      [1, 330, 316, 917, 484],
      [2, 407, 413, 836, 459],
    ],
  },
  {
    source: 'research-table-preview.png',
    output: 'research/outputs-01.png',
    marks: [
      [1, 2, 1, 1035, 36],
      [2, 575, 395, 1034, 446],
    ],
  },
  {
    source: 'research-chart-gallery.png',
    crop: '1600x1700+0+0',
    output: 'research/outputs-02.png',
    redact: [[1222, 9, 1507, 43]],
    marks: [
      [1, 398, 334, 1435, 1008],
      [2, 398, 1024, 1435, 1694],
    ],
  },
  {
    source: 'research-affected-run.png',
    crop: '1600x930+0+0',
    output: 'research/run-control-01.png',
    redact: [[1220, 10, 1507, 43]],
    marks: [
      [1, 1352, 148, 1416, 193],
      [2, 401, 147, 1441, 921],
    ],
  },
  {
    source: 'research-interrupt-running.png',
    crop: '1600x800+0+0',
    output: 'research/run-control-02.png',
    redact: [[1220, 10, 1507, 43]],
    marks: [
      [1, 1350, 148, 1416, 194],
      [2, 400, 149, 1440, 764],
    ],
  },
  {
    source: 'research-cell-change-inline-review.png',
    output: 'research/agent-collaboration-01.png',
    redact: [[1170, 8, 1510, 43]],
    marks: [
      [1, 267, 332, 1254, 613],
      [2, 1293, 225, 1586, 474],
    ],
  },
  {
    source: 'research-agent-proposal-accepted.png',
    output: 'research/agent-collaboration-02.png',
    redact: [[948, 9, 1122, 43]],
    marks: [
      [1, 269, 330, 918, 663],
      [2, 966, 273, 1278, 650],
    ],
  },
  {
    source: 'research-execution-promoted.png',
    crop: '1600x900+0+0',
    output: 'research/handoff-01.png',
    marks: [
      [1, 838, 0, 1598, 899],
      [2, 859, 94, 1580, 334],
    ],
  },
  {
    source: 'research-curator-summary-zh.png',
    crop: '720x960+720+0',
    output: 'research/curator-01.png',
    marks: [
      [1, 8, 8, 702, 52],
      [2, 103, 172, 697, 286],
      [3, 103, 482, 697, 950],
    ],
  },
  {
    source: 'research-execution-history.png',
    crop: '1600x700+0+0',
    output: 'research/records-01.png',
    redact: [[1220, 9, 1510, 43]],
    marks: [
      [1, 877, 1, 1598, 698],
      [2, 898, 78, 1580, 160],
    ],
  },
  {
    source: '13a-python-factor-sdk.png',
    output: 'factors/python-factor-01.png',
    redact: [[1260, 9, 1510, 43]],
    marks: [
      [1, 338, 58, 970, 995],
      [2, 404, 325, 951, 803],
      [3, 1460, 57, 1598, 97],
    ],
  },
  {
    source: '8a-factor-robust-inference.png',
    output: 'factors/robust-inference-01.png',
    marks: [[1, 5, 5, 514, 315]],
  },
  {
    source: '8b-factor-robust-inference-report.png',
    crop: '570x900+870+60',
    output: 'factors/robust-inference-02.png',
    marks: [
      [1, 2, 2, 565, 448],
      [2, 2, 452, 565, 895],
    ],
  },
  {
    source: 'public-library.png',
    crop: '1280x800+0+0',
    output: 'library/share-copy-01.png',
    redact: [[1050, 9, 1275, 43]],
    marks: [
      [1, 115, 119, 1165, 200],
      [2, 115, 231, 1165, 620],
    ],
  },
  {
    source: 'technical-indicators-e2e.png',
    output: 'backtesting/technical-indicators-01.png',
    redact: [[1035, 9, 1180, 43]],
    marks: [
      [1, 338, 55, 968, 520],
      [2, 970, 98, 1278, 633],
    ],
  },
];

for (const job of jobs) {
  render(job);
}
console.log(`[help-content-stage-l] PASS ${jobs.length} annotated screenshots`);

function render(job) {
  const source = `${ACCEPTANCE}${job.source}`;
  if (!existsSync(source)) {
    throw new Error(`missing E2E source screenshot: ${job.source}`);
  }
  const args = [source];
  if (job.crop) {
    args.push('-crop', job.crop, '+repage');
  }
  if (annotationFont) {
    args.push('-font', annotationFont);
  }
  for (const [x1, y1, x2, y2] of job.redact ?? []) {
    args.push('-fill', 'white', '-stroke', 'none', '-draw', `rectangle ${x1},${y1} ${x2},${y2}`);
  }
  for (const [number, x1, y1, x2, y2] of job.marks) {
    const badgeX = Math.max(18, x1 + 3);
    const badgeY = Math.max(18, y1 + 3);
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
      '-pointsize',
      '20',
      '-draw',
      `text ${badgeX - 6},${badgeY + 7} '${number}'`,
    );
  }
  const output = `${DOCS_IMAGES}${job.output}`;
  args.push('-strip', output);
  const result = spawnSync('/opt/homebrew/bin/magick', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`failed to create ${job.output}: ${result.stderr || result.stdout}`);
  }
}

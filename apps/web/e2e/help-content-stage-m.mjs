import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ACCEPTANCE = new URL('../acceptance/', import.meta.url).pathname;
const DOCS_IMAGES = new URL('../../docs/public/images/help/zh/research/', import.meta.url).pathname;
const red = '#e8463b';
const annotationFont = [
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].find(existsSync);

mkdirSync(DOCS_IMAGES, { recursive: true });

const jobs = [
  {
    source: 'research-new-prompt.png',
    output: 'new-research-01.png',
    redact: [[1110, 5, 1495, 48]],
    marks: [
      [1, 558, 646, 1281, 727],
      [2, 1233, 672, 1274, 714],
      [3, 15, 157, 226, 205],
    ],
  },
  {
    source: 'research-clarification-pending.png',
    output: 'clarifications-01.png',
    redact: [[1180, 5, 1515, 48]],
    marks: [
      [1, 1293, 272, 1587, 742],
      [2, 1290, 900, 1590, 995],
    ],
  },
  {
    source: 'research-clarification-answered.png',
    output: 'clarifications-02.png',
    redact: [[1180, 5, 1515, 48]],
    marks: [
      [1, 1293, 272, 1587, 886],
      [2, 1512, 281, 1583, 319],
    ],
  },
  {
    source: 'research-yield-runtime-data.png',
    output: 'yield-curves-01.png',
    marks: [
      [1, 65, 53, 1006, 552],
      [2, 2, 608, 1037, 821],
    ],
  },
  {
    source: 'research-yield-runtime-stats.png',
    output: 'yield-curves-02.png',
    marks: [
      [1, 65, 53, 1007, 410],
      [2, 2, 448, 1037, 714],
    ],
  },
  {
    source: 'research-yield-runtime-stats.png',
    output: 'python-runtime-01.png',
    marks: [
      [1, 66, 53, 414, 104],
      [2, 65, 105, 1008, 410],
      [3, 2, 448, 1037, 714],
    ],
  },
];

for (const job of jobs) {
  render(job);
}
console.log(`[help-content-stage-m] PASS ${jobs.length} annotated screenshots`);

function render(job) {
  const source = `${ACCEPTANCE}${job.source}`;
  if (!existsSync(source)) {
    throw new Error(`missing E2E source screenshot: ${job.source}`);
  }
  const args = [source];
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
  args.push('-strip', `${DOCS_IMAGES}${job.output}`);
  const result = spawnSync('/opt/homebrew/bin/magick', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`failed to create ${job.output}: ${result.stderr || result.stdout}`);
  }
}

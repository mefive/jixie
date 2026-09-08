import { writeFileSync } from 'node:fs';
import { prisma } from '../src/infra/database/prisma.js';
import {
  EQUITY_FCFF_REPLAY_CASES,
  equityFcffParameterSource,
} from '../src/research/equity-fcff-replay-cases.js';
import {
  createResearchDocument,
  updateResearchCell,
  runResearchDocument,
  closeResearchDocumentRuntime,
} from '../src/research/workbench.js';
import { promoteResearchExecution } from '../src/research/research-execution-records.js';

// Explicit owner and output arguments keep this separate from disposable E2E fixtures.
const [email, outputPath] = process.argv.slice(2);
if (!email || !outputPath) {
  throw new Error('Usage: create-fcff-research-replays.ts <existing-owner-email> <manifest.json>');
}
const manifest: {
  company: string;
  identifier: string;
  documentId: string;
  executionId?: string;
  status: string;
}[] = [];
try {
  const owner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!owner) {
    throw new Error('Existing Research owner not found');
  }
  for (const replayCase of EQUITY_FCFF_REPLAY_CASES) {
    const title = `${replayCase.companyName} · 估值与市场复核 · 2026-09-07`;
    const existing = await prisma.agentConversation.findFirst({
      where: { userId: owner.id, surface: 'research', title },
      select: { id: true },
    });
    if (existing) {
      throw new Error(`Research already exists; inspect before creating another: ${existing.id}`);
    }
    const document = await createResearchDocument(owner.id, 'equity_fcff_valuation');
    const entry: (typeof manifest)[number] = {
      company: replayCase.companyName,
      identifier: replayCase.identifier,
      documentId: document.id,
      status: 'created',
    };
    manifest.push(entry);
    writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
    try {
      await prisma.agentConversation.update({ where: { id: document.id }, data: { title } });
      const parameters = document.cells.find(
        (cell) => cell.kind === 'python' && cell.source.includes('valuation_identifier ='),
      )!;
      const introduction = document.cells.find((cell) => cell.kind === 'markdown')!;
      await updateResearchCell(owner.id, parameters.id, {
        source: equityFcffParameterSource(replayCase),
        expectedRevision: parameters.revision,
      });
      await updateResearchCell(owner.id, introduction.id, {
        expectedRevision: introduction.revision,
        source: `# ${title}\n\n${replayCase.identifier}；${replayCase.businessPattern}。初始估值日 ${replayCase.valuationDate}，年度复查日 ${replayCase.reviewDate}，市场截止日 2026-07-30。\n\n这是三家公司事后选取的研究演练。原代理口径与年报附注局部调整并列，缺口保留；不代表独立样本外验证或已核准合理价。参数和来源均可编辑，修改后应干净运行全文。`,
      });
      const result = await runResearchDocument(owner.id, document.id, true);
      entry.executionId = result?.execution?.id;
      entry.status = result?.execution?.status ?? 'unavailable';
      if (!result?.execution || entry.status !== 'success') {
        throw new Error(`Clean Research run failed: ${JSON.stringify(result?.execution)}`);
      }
      await promoteResearchExecution(owner.id, result.execution.id, {
        displayName: `${replayCase.companyName} · 年报局部分类与市场复核`,
        tags: ['FCFF', 'retrospective', 'partial-classification'],
        userNote:
          '保留原教学参数与执行；附注调整仅覆盖已识别项目。年报锚点不是最新季度合理价，三例不是Holdout。',
      });
      entry.status = 'success_sealed';
      console.log(`${replayCase.companyName}: ${document.id} / ${entry.executionId}`);
    } finally {
      closeResearchDocumentRuntime(document.id);
      writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
    }
  }
} finally {
  await prisma.$disconnect();
}

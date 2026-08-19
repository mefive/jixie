import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

export const RESEARCH_CELL_CHANGE_FIXTURE = {
  email: 'e2e-research-cell-change@test.com',
  userId: 'e2e-research-cell-change-user',
  conversationId: '01M0A1YW42TSJ3BFAS6E5KC39Q',
  documentId: '01M0A1YW42TSJ3BFAS6E5KC39Q',
  title: 'Agent 变更提案验收',
  markdownCellId: 'e2e-research-cell-change-markdown',
  pythonCellId: 'e2e-research-cell-change-python',
  scratchCellId: 'e2e-research-cell-change-scratch',
  createdCellId: 'e2e-research-cell-change-created',
  applyProposalId: 'e2e-research-cell-change-apply',
  rejectProposalId: 'e2e-research-cell-change-reject',
  conflictProposalId: 'e2e-research-cell-change-conflict',
};

const databaseUrl = `file:${fileURLToPath(new URL('../../api/prisma/dev.db', import.meta.url))}`;

export async function seedResearchCellChangeFixture() {
  const database = new PrismaClient({ datasourceUrl: databaseUrl });
  const fixture = RESEARCH_CELL_CHANGE_FIXTURE;
  const markdownSource = '## 滚动风险研究';
  const pythonBefore = `import pandas as pd

returns = pd.Series([0.012, -0.006, 0.018, 0.004])
monthly_mean = returns.mean()
monthly_mean`;
  const pythonAfter = `import pandas as pd

returns = pd.Series([0.012, -0.006, 0.018, 0.004])
rolling_window = 3
rolling_mean = returns.rolling(rolling_window).mean()
rolling_vol = returns.rolling(rolling_window).std()
downside = returns.clip(upper=0).abs()
summary = pd.DataFrame(
    {"return": returns, "mean": rolling_mean, "vol": rolling_vol}
)
summary`;
  const createdMarkdown = `### 研究限制

- 当前仅用小样本演示统计路径。
- 扩展到真实数据后需补充稳定性验证。`;
  const now = new Date();

  try {
    await database.agentConversation.deleteMany({ where: { id: fixture.conversationId } });
    await database.user.upsert({
      where: { email: fixture.email },
      update: { status: 'active' },
      create: { id: fixture.userId, email: fixture.email, status: 'active' },
    });
    await database.agentConversation.create({
      data: {
        id: fixture.conversationId,
        userId: fixture.userId,
        surface: 'research',
        title: fixture.title,
      },
    });
    const document = await database.researchDocument.create({
      data: {
        id: fixture.documentId,
        userId: fixture.userId,
        conversationId: fixture.conversationId,
        cells: {
          create: [
            {
              id: fixture.markdownCellId,
              position: 0,
              kind: 'markdown',
              source: markdownSource,
              definitions: [],
              references: [],
            },
            {
              id: fixture.pythonCellId,
              position: 1,
              kind: 'python',
              source: pythonBefore,
              definitions: ['returns', 'monthly_mean'],
              references: ['pd'],
            },
            {
              id: fixture.scratchCellId,
              position: 2,
              kind: 'markdown',
              source: '临时备忘',
              definitions: [],
              references: [],
            },
          ],
        },
      },
    });
    const expectedDocumentUpdatedAt = document.updatedAt.toISOString();
    const expectedDocumentContentRevision = document.contentRevision;
    const proposals = [
      {
        id: fixture.applyProposalId,
        title: '补充滚动均值与波动率',
        summary:
          '保留原始收益序列，将单一均值改为滚动均值、滚动波动率与下行幅度摘要，并补充研究限制。',
        operations: [
          {
            operationId: 'e2e-research-cell-change-operation-update',
            cellId: fixture.pythonCellId,
            kind: 'update',
            cellKind: 'python',
            position: 1,
            expectedRevision: 1,
            beforeSource: pythonBefore,
            afterSource: pythonAfter,
            addedLines: 8,
            removedLines: 2,
            afterDefinitions: [
              'returns',
              'rolling_window',
              'rolling_mean',
              'rolling_vol',
              'downside',
              'summary',
            ],
            afterReferences: ['pd'],
          },
          {
            operationId: 'e2e-research-cell-change-operation-create',
            cellId: fixture.createdCellId,
            kind: 'create',
            cellKind: 'markdown',
            position: 2,
            afterCellId: fixture.pythonCellId,
            beforeSource: '',
            afterSource: createdMarkdown,
            addedLines: 4,
            removedLines: 0,
            afterDefinitions: [],
            afterReferences: [],
          },
          {
            operationId: 'e2e-research-cell-change-operation-delete',
            cellId: fixture.scratchCellId,
            kind: 'delete',
            cellKind: 'markdown',
            position: 2,
            expectedRevision: 1,
            beforeSource: '临时备忘',
            afterSource: '',
            addedLines: 0,
            removedLines: 1,
            afterDefinitions: [],
            afterReferences: [],
          },
        ],
      },
      {
        id: fixture.rejectProposalId,
        title: '替换研究标题',
        summary: '这是一个用于验证拒绝流程的备选提案。',
        operations: [
          {
            operationId: 'e2e-research-cell-change-operation-reject',
            cellId: fixture.markdownCellId,
            kind: 'update',
            cellKind: 'markdown',
            position: 0,
            expectedRevision: 1,
            beforeSource: markdownSource,
            afterSource: '## 短周期波动率研究',
            addedLines: 1,
            removedLines: 1,
            afterDefinitions: [],
            afterReferences: [],
          },
        ],
      },
      {
        id: fixture.conflictProposalId,
        title: '改写研究假设',
        summary: '在用户已编辑 Cell 后，应被修订检查拦截而不是覆盖新内容。',
        operations: [
          {
            operationId: 'e2e-research-cell-change-operation-conflict',
            cellId: fixture.markdownCellId,
            kind: 'update',
            cellKind: 'markdown',
            position: 0,
            expectedRevision: 1,
            beforeSource: markdownSource,
            afterSource: '## 滚动风险研究\n\n假设：短期波动率具有聚集特征。',
            addedLines: 3,
            removedLines: 1,
            afterDefinitions: [],
            afterReferences: [],
          },
        ],
      },
    ];

    for (const [index, draft] of proposals.entries()) {
      const turnId = `e2e-research-cell-change-turn-${index + 1}`;
      const userMessageId = `e2e-research-cell-change-user-message-${index + 1}`;
      const assistantMessageId = `e2e-research-cell-change-assistant-message-${index + 1}`;
      const proposal = {
        version: 1,
        id: draft.id,
        documentId: fixture.documentId,
        title: draft.title,
        summary: draft.summary,
        status: 'pending',
        expectedDocumentUpdatedAt,
        expectedDocumentContentRevision,
        operations: draft.operations,
        createdAt: new Date(now.getTime() + index * 1_000).toISOString(),
      };
      await database.agentTurn.create({
        data: {
          id: turnId,
          conversationId: fixture.conversationId,
          status: 'done',
          model: 'e2e-fixture',
          trace: { version: 1, steps: [], truncated: false },
          finishedAt: now,
        },
      });
      await database.agentMessage.createMany({
        data: [
          {
            id: userMessageId,
            conversationId: fixture.conversationId,
            role: 'user',
            parts: [{ type: 'text', text: `请准备第 ${index + 1} 个 Cell 变更提案。` }],
            sequence: index * 2,
            turnId,
          },
          {
            id: assistantMessageId,
            conversationId: fixture.conversationId,
            role: 'assistant',
            parts: [
              { type: 'text', text: '已准备变更提案，尚未应用或运行。' },
              { type: 'research_cell_change', proposal },
            ],
            sequence: index * 2 + 1,
            turnId,
          },
        ],
      });
      await database.researchCellChangeProposal.create({
        data: {
          id: proposal.id,
          documentId: fixture.documentId,
          sourceTurnId: turnId,
          sourceMessageId: assistantMessageId,
          sourcePartIndex: 1,
          title: proposal.title,
          summary: proposal.summary,
          expectedDocumentUpdatedAt: document.updatedAt,
          expectedDocumentContentRevision,
          operations: proposal.operations,
          status: 'pending',
          createdAt: new Date(proposal.createdAt),
        },
      });
    }

    return fixture;
  } finally {
    await database.$disconnect();
  }
}

export async function seedResearchCellChangeFollowupProposal({
  suffix,
  title,
  summary,
  appendedSource,
  definition,
  replacementSource,
  definitions,
}) {
  const database = new PrismaClient({ datasourceUrl: databaseUrl });
  const fixture = RESEARCH_CELL_CHANGE_FIXTURE;
  try {
    const document = await database.researchDocument.findUniqueOrThrow({
      where: { id: fixture.documentId },
      include: { cells: { where: { id: fixture.pythonCellId } } },
    });
    const cell = document.cells[0];
    if (!cell) {
      throw new Error('Review fixture Python Cell was not found.');
    }
    const lastMessage = await database.agentMessage.findFirst({
      where: { conversationId: fixture.conversationId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    const sequence = (lastMessage?.sequence ?? -1) + 1;
    const turnId = `e2e-research-cell-change-review-turn-${suffix}`;
    const userMessageId = `e2e-research-cell-change-review-user-${suffix}`;
    const assistantMessageId = `e2e-research-cell-change-review-assistant-${suffix}`;
    const proposalId = `e2e-research-cell-change-review-${suffix}`;
    const afterSource = replacementSource ?? `${cell.source}\n${appendedSource}`;
    const proposal = {
      version: 1,
      id: proposalId,
      documentId: fixture.documentId,
      title,
      summary,
      status: 'pending',
      expectedDocumentUpdatedAt: document.updatedAt.toISOString(),
      expectedDocumentContentRevision: document.contentRevision,
      operations: [
        {
          operationId: `e2e-research-cell-change-review-operation-${suffix}`,
          cellId: cell.id,
          kind: 'update',
          cellKind: 'python',
          position: cell.position,
          expectedRevision: cell.revision,
          beforeSource: cell.source,
          afterSource,
          addedLines: replacementSource ? replacementSource.split('\n').length : 1,
          removedLines: replacementSource ? cell.source.split('\n').length : 0,
          afterDefinitions: definitions ?? [...new Set([...cell.definitions, definition])],
          afterReferences: cell.references,
        },
      ],
      createdAt: new Date().toISOString(),
    };
    await database.agentTurn.create({
      data: {
        id: turnId,
        conversationId: fixture.conversationId,
        status: 'done',
        model: 'e2e-fixture',
        trace: { version: 1, steps: [], truncated: false },
        finishedAt: new Date(),
      },
    });
    await database.agentMessage.createMany({
      data: [
        {
          id: userMessageId,
          conversationId: fixture.conversationId,
          role: 'user',
          parts: [{ type: 'text', text: `继续修改当前 Cell：${title}` }],
          sequence,
          turnId,
        },
        {
          id: assistantMessageId,
          conversationId: fixture.conversationId,
          role: 'assistant',
          parts: [
            { type: 'text', text: '已基于当前未接受版本准备追加修改。' },
            { type: 'research_cell_change', proposal },
          ],
          sequence: sequence + 1,
          turnId,
        },
      ],
    });
    await database.researchCellChangeProposal.create({
      data: {
        id: proposal.id,
        documentId: fixture.documentId,
        sourceTurnId: turnId,
        sourceMessageId: assistantMessageId,
        sourcePartIndex: 1,
        title: proposal.title,
        summary: proposal.summary,
        expectedDocumentUpdatedAt: document.updatedAt,
        expectedDocumentContentRevision: document.contentRevision,
        operations: proposal.operations,
        status: 'pending',
        createdAt: new Date(proposal.createdAt),
      },
    });
    return { proposalId, beforeSource: cell.source, afterSource };
  } finally {
    await database.$disconnect();
  }
}

export async function cleanupResearchCellChangeFixture() {
  const database = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await database.agentConversation.deleteMany({
      where: { id: RESEARCH_CELL_CHANGE_FIXTURE.conversationId },
    });
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? 'seed';
  const result =
    action === 'cleanup'
      ? await cleanupResearchCellChangeFixture().then(() => ({ cleaned: true }))
      : await seedResearchCellChangeFixture();
  console.log(JSON.stringify(result));
}

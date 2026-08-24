import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

export const RESEARCH_CLARIFICATION_FIXTURE = {
  email: 'e2e-research-cell-change@test.com',
  userId: 'e2e-research-cell-change-user',
  conversationId: '01M0RESEARCHCLARIFICATION01',
  documentId: '01M0RESEARCHCLARIFICATION01',
  title: '黄金价格口径确认',
  turnId: 'e2e-research-clarification-turn',
  assistantMessageId: 'e2e-research-clarification-assistant',
  clarificationId: 'e2e-research-clarification-choice',
  questionId: 'e2e-research-clarification-question',
};

const databaseUrl = `file:${fileURLToPath(new URL('../../api/prisma/dev.db', import.meta.url))}`;

export async function seedResearchClarificationFixture() {
  const database = new PrismaClient({ datasourceUrl: databaseUrl });
  const fixture = RESEARCH_CLARIFICATION_FIXTURE;
  const createdAt = new Date();
  const clarification = {
    version: 1,
    id: fixture.clarificationId,
    documentId: fixture.documentId,
    title: '确认黄金价格口径',
    status: 'pending',
    questions: [
      {
        id: fixture.questionId,
        prompt: '平台没有美元现货黄金。本次研究使用哪个可执行口径？',
        selectionMode: 'single',
        allowCustom: true,
        options: [
          {
            id: 'binding:commodity.gold.price.future.au_shf',
            kind: 'binding',
            referenceId: 'commodity.gold.price.future.au_shf',
            labelZh: '沪金主力连续',
            labelEn: 'SHFE gold continuous future',
            descriptionZh: '人民币计价的连续期货代理，不等同于美元现货黄金。',
            descriptionEn: 'A CNY continuous-future proxy; it is not USD spot gold.',
          },
          {
            id: 'binding:commodity.gold.price.etf.518880_sh',
            kind: 'binding',
            referenceId: 'commodity.gold.price.etf.518880_sh',
            labelZh: '黄金 ETF 518880.SH',
            labelEn: 'Gold ETF 518880.SH',
            descriptionZh: '人民币交易的 ETF 代理，费用和跟踪误差会影响结果。',
            descriptionEn: 'A CNY-traded ETF proxy with fees and tracking error.',
          },
          {
            id: 'keep_gap',
            kind: 'keep_gap',
            labelZh: '不使用代理',
            labelEn: 'Do not substitute',
            descriptionZh: '保留美元现货黄金定义，并记录当前平台数据缺口。',
            descriptionEn: 'Keep the USD spot-gold definition and record the current data gap.',
          },
        ],
      },
    ],
    createdAt: createdAt.toISOString(),
  };

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
    await database.researchDocument.create({
      data: {
        id: fixture.documentId,
        userId: fixture.userId,
        conversationId: fixture.conversationId,
        cells: {
          create: [
            {
              id: 'e2e-research-clarification-markdown',
              position: 0,
              kind: 'markdown',
              source:
                '# 黄金价格研究\n\n目标：研究黄金价格走势。原始需求指向美元现货黄金，必须先确认平台代理口径。',
              definitions: [],
              references: [],
            },
            {
              id: 'e2e-research-clarification-python',
              position: 1,
              kind: 'python',
              source: '# 等待用户确认数据口径后，由 Agent 补充可运行代码。',
              definitions: [],
              references: [],
            },
          ],
        },
      },
    });
    await database.agentTurn.create({
      data: {
        id: fixture.turnId,
        conversationId: fixture.conversationId,
        status: 'done',
        model: 'e2e-fixture',
        trace: { version: 1, steps: [], truncated: false },
        finishedAt: createdAt,
      },
    });
    await database.agentMessage.createMany({
      data: [
        {
          id: 'e2e-research-clarification-user-message',
          conversationId: fixture.conversationId,
          role: 'user',
          parts: [
            {
              type: 'text',
              text: '研究美元现货黄金走势；先确认数据口径，确认后补充 Python 与交互图。',
            },
          ],
          sequence: 0,
          turnId: fixture.turnId,
        },
        {
          id: fixture.assistantMessageId,
          conversationId: fixture.conversationId,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: '平台没有精确的美元现货黄金序列。请选择是否使用可执行代理。',
            },
            { type: 'research_clarification', clarification },
          ],
          sequence: 1,
          turnId: fixture.turnId,
        },
      ],
    });
    await database.researchClarification.create({
      data: {
        id: clarification.id,
        documentId: fixture.documentId,
        sourceTurnId: fixture.turnId,
        sourceMessageId: fixture.assistantMessageId,
        sourcePartIndex: 1,
        title: clarification.title,
        questions: clarification.questions,
        status: 'pending',
        createdAt,
      },
    });
    return fixture;
  } finally {
    await database.$disconnect();
  }
}

export async function cleanupResearchClarificationFixture() {
  const database = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await database.agentConversation.deleteMany({
      where: { id: RESEARCH_CLARIFICATION_FIXTURE.conversationId },
    });
  } finally {
    await database.$disconnect();
  }
}

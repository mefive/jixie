import { z } from 'zod';
import { messageText, type ChatMessage } from '@jixie/shared';
import { chatJson, type LlmCall } from '../llm/deepseek.js';
import { prisma } from '../lib/prisma.js';

const metadataSchema = z.object({
  nameZh: z.string().trim().min(1).max(40),
  descriptionZh: z.string().trim().min(1).max(240),
  descriptionEn: z.string().trim().min(1).max(400),
});

export interface FactorMetadata {
  nameZh: string;
  descriptionZh: string;
  descriptionEn: string;
}

/** Generate display metadata from the current code and recent conversation. */
export async function generateFactorMetadata(
  input: {
    code: string;
    messages: ChatMessage[];
    currentName?: string;
    currentDescriptionZh?: string;
    currentDescriptionEn?: string;
    analysisKind?: 'cross_sectional' | 'time_series';
  },
  llm: LlmCall = chatJson,
): Promise<FactorMetadata> {
  const context = input.messages
    .slice(-8)
    .map((message) => `${message.role}: ${messageText(message).slice(0, 600)}`)
    .join('\n');
  const raw = await llm([
    {
      role: 'system',
      content: `You maintain metadata for a ${input.analysisKind === 'time_series' ? 'multi-asset ETF time-series signal' : 'cross-sectional A-share research factor'}. Return one JSON object with exactly these fields:
- nameZh: a concise Chinese factor name, at most 12 Chinese characters when practical.
- descriptionZh: one concise Chinese sentence explaining the signal, direction, and important window or data dependency.
- descriptionEn: the equivalent concise English sentence.
Keep the current name and descriptions when they remain accurate; update them when the code or conversation changes. Never include IDs, uniqueness suffixes, markdown, or commentary.`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        currentName: input.currentName ?? '',
        currentDescriptionZh: input.currentDescriptionZh ?? '',
        currentDescriptionEn: input.currentDescriptionEn ?? '',
        recentConversation: context,
        code: input.code,
      }),
    },
  ]);
  const parsed = metadataSchema.parse(JSON.parse(raw));
  return {
    nameZh: parsed.nameZh,
    descriptionZh: parsed.descriptionZh,
    descriptionEn: parsed.descriptionEn,
  };
}

/** Refresh mutable display metadata for a draft factor. */
export async function refreshFactorMetadata(input: {
  factorId: string;
  userId: string;
  code: string;
  messages: ChatMessage[];
}): Promise<void> {
  const existing = await prisma.factor.findFirst({
    where: { id: input.factorId, userId: input.userId },
    select: {
      name: true,
      descriptionZh: true,
      descriptionEn: true,
      analysisKind: true,
      status: true,
    },
  });
  if (!existing || existing.status !== 'draft') {
    return;
  }

  const metadata = await generateFactorMetadata({
    code: input.code,
    messages: input.messages,
    currentName: existing.name,
    currentDescriptionZh: existing.descriptionZh,
    currentDescriptionEn: existing.descriptionEn,
    analysisKind: existing.analysisKind === 'time_series' ? 'time_series' : 'cross_sectional',
  });
  await prisma.factor.update({
    where: { id: input.factorId },
    data: {
      name: metadata.nameZh,
      descriptionZh: metadata.descriptionZh,
      descriptionEn: metadata.descriptionEn,
    },
  });
}

import { z } from 'zod';
import { messageText, type ChatMessage } from '@jixie/shared';
import type { LlmCall } from '../llm/nl-to-structured.js';
import { chatJson } from '../llm/deepseek.js';
import { prisma } from '../lib/prisma.js';

const MAX_KEY_LENGTH = 32;

const metadataSchema = z.object({
  nameZh: z.string().trim().min(1).max(40),
  key: z.string().trim().min(1).max(80),
  descriptionZh: z.string().trim().min(1).max(240),
  descriptionEn: z.string().trim().min(1).max(400),
});

export interface FactorMetadata {
  nameZh: string;
  keyCandidate: string;
  descriptionZh: string;
  descriptionEn: string;
}

/** Convert an LLM key proposal to the same lower_snake_case alphabet accepted by finalization. */
export function normalizeFactorKey(value: string): string {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (/^[0-9]/.test(normalized)) {
    normalized = `factor_${normalized}`;
  }
  return normalized.slice(0, MAX_KEY_LENGTH).replace(/_+$/g, '') || 'factor';
}

/** Generate display metadata from the current code and recent conversation. */
export async function generateFactorMetadata(
  input: {
    code: string;
    messages: ChatMessage[];
    currentName?: string;
    currentDescriptionZh?: string;
    currentDescriptionEn?: string;
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
      content: `You maintain metadata for an A-share research factor. Return one JSON object with exactly these fields:
- nameZh: a concise Chinese factor name, at most 12 Chinese characters when practical.
- key: a short, descriptive lower_snake_case English identifier suitable for source code. Do not add "factor" unless necessary.
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
    keyCandidate: normalizeFactorKey(parsed.key),
    descriptionZh: parsed.descriptionZh,
    descriptionEn: parsed.descriptionEn,
  };
}

/** Refresh mutable metadata; an existing key proposal remains user-owned and is never overwritten. */
export async function refreshFactorMetadata(input: {
  factorId: string;
  userId: string;
  code: string;
  messages: ChatMessage[];
}): Promise<void> {
  const existing = await prisma.factor.findFirst({
    where: { id: input.factorId, userId: input.userId },
    select: {
      key: true,
      keyCandidate: true,
      name: true,
      descriptionZh: true,
      descriptionEn: true,
    },
  });
  if (!existing) {
    return;
  }

  const metadata = await generateFactorMetadata({
    code: input.code,
    messages: input.messages,
    currentName: existing.name,
    currentDescriptionZh: existing.descriptionZh,
    currentDescriptionEn: existing.descriptionEn,
  });
  await prisma.factor.update({
    where: { id: input.factorId },
    data: {
      name: metadata.nameZh,
      descriptionZh: metadata.descriptionZh,
      descriptionEn: metadata.descriptionEn,
      ...(!existing.key && !existing.keyCandidate ? { keyCandidate: metadata.keyCandidate } : {}),
    },
  });
}

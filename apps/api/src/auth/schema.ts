import { z } from 'zod';
import { normalizeInviteCode } from './invite-code.js';

// Email login.
const emailField = z
  .string()
  .trim()
  .email()
  .transform((s) => s.toLowerCase());

export const emailLoginRequestSchema = z.object({
  email: emailField,
  inviteCode: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? normalizeInviteCode(v) : undefined)),
});

export const emailLoginVerifySchema = z.object({
  challengeId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'code must be 6 digits'),
});

export const developmentLoginSchema = z.object({ email: emailField });

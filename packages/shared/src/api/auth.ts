import { z } from 'zod';

// Email login.
const emailField = z
  .string()
  .trim()
  .email()
  .transform((s) => s.toLowerCase());

export const emailLoginRequestSchema = z.object({
  email: emailField,
  inviteCode: z.string().trim().min(1).optional(),
});

export const emailLoginVerifySchema = z.object({
  challengeId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'code must be 6 digits'),
});

export const developmentLoginSchema = z.object({ email: emailField });

// HTTP input types describe values before defaults and transformations.
export type EmailLoginRequest = z.input<typeof emailLoginRequestSchema>;
export type VerifyEmailLoginRequest = z.input<typeof emailLoginVerifySchema>;
export type DevelopmentLoginRequest = z.input<typeof developmentLoginSchema>;

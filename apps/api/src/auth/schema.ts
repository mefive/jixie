import { emailLoginRequestSchema as emailLoginWireSchema } from '@jixie/shared/api/auth';
import { normalizeInviteCode } from './invite-code.js';

export const emailLoginRequestSchema = emailLoginWireSchema.extend({
  inviteCode: emailLoginWireSchema.shape.inviteCode.transform((value) =>
    value ? normalizeInviteCode(value) : undefined,
  ),
});

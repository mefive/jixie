/**
 * 保存已校验但尚未获用户接受的代码建议，与当前业务代码分开。
 *
 * Retain a validated code suggestion separately from the user's accepted business code.
 */
export interface CodeChangeProposalV1 {
  version: 1;
  id: string;
  surface: 'factor' | 'strategy';
  entityId: string;
  language: 'typescript' | 'python';
  beforeCode: string;
  afterCode: string;
  status: 'pending' | 'accepted';
  createdAt: string;
  acceptedAt?: string;
}

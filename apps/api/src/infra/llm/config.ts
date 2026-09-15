// Shared by provider requests and persisted model attribution. Explicit overrides take priority.
const DEFAULT_MODEL = 'deepseek-flash';

export function getDeepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
}

export function getDeepSeekAgentModel(): string {
  return process.env.DEEPSEEK_AGENT_MODEL ?? getDeepSeekModel();
}

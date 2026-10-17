export interface ResearchInputRequest {
  method: string;
  arguments: unknown;
}

export type ResearchInputResponse = { result: Record<string, unknown> } | { error: string };

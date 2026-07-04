// A turn in the strategy agent conversation (回测台 Agent panel). The agent iterates on the current
// strategy code: a 'user' turn is what the user typed, an 'assistant' turn is the agent's reply (a short
// explanation of what it changed). The code itself lives on the strategy (config.code) — a message only
// carries the human-readable text, not the code, so the conversation stays light. Persisted per strategy
// (Strategy.messages) so reopening a strategy restores its conversation.

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DataCleanupInput {
  apply: boolean;
  backup?: () => Promise<string>;
  signal?: AbortSignal;
}

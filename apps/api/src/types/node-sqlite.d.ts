/** Minimal ambient types for node:sqlite (needs Node ≥22.13 at runtime; @types/node here is v20
 * which predates the module). Only the surface the read-only SQL worker touches. */
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    public constructor(
      location: string,
      options?: { readOnly?: boolean; open?: boolean; timeout?: number },
    );
    public prepare(sql: string): StatementSync;
    public close(): void;
  }
}

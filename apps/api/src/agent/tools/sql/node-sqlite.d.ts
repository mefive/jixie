/** Node ≥22.13 的 SQLite 管理与只读查询类型，补充当前 Node 20 类型包。
 * SQLite administration and read-only types for Node ≥22.13, supplementing Node 20 declarations. */
declare module 'node:sqlite' {
  export type SQLInputValue = null | number | bigint | string | NodeJS.ArrayBufferView;

  export interface StatementSync {
    get(...params: SQLInputValue[]): Record<string, unknown> | undefined;
    iterate(...params: SQLInputValue[]): IterableIterator<Record<string, unknown>>;
    run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...params: unknown[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    public constructor(
      location: string,
      options?: { readOnly?: boolean; open?: boolean; timeout?: number },
    );
    public prepare(sql: string): StatementSync;
    public exec(sql: string): void;
    public close(): void;
  }
}

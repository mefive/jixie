import type { ResearchCellKindV1 } from '@jixie/shared';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';

/**
 * 定义新建 Cell 的种类、源码和位置，供模板或提案创建。
 *
 * Supply cell kind, source and position for template or proposal creation.
 */
export interface CellSeed {
  kind: ResearchCellKindV1;
  source: string;
  config?: Record<string, unknown>;
}

export function cellCreate(cell: CellSeed, position: number) {
  return {
    id: ulid(),
    position,
    kind: cell.kind,
    source: cell.source,
    ...(cell.config ? { config: cell.config as unknown as Prisma.InputJsonValue } : {}),
    definitions: [] as unknown as Prisma.InputJsonValue,
    references: [] as unknown as Prisma.InputJsonValue,
  };
}

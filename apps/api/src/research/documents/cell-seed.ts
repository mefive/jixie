import type { ResearchCellKindV1 } from '@jixie/shared';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';

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

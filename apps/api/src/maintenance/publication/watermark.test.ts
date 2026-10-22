import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeDailyWatermark } from './watermark.js';
const database = vi.hoisted(() => ({
  findState: vi.fn(),
  createState: vi.fn(),
  updateState: vi.fn(),
}));
const { findState, createState, updateState } = database;
vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          maintenanceState: {
            findUnique: database.findState,
            create: database.createState,
            update: database.updateState,
          },
        }),
    },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

beforeEach(() => vi.resetAllMocks());
describe('publication watermark initialization', () => {
  it('treats repeated initialization at the same watermark as a no-op', async () => {
    findState.mockResolvedValue({ dailyPublishedThrough: '20260730' });

    await expect(initializeDailyWatermark('20260730')).resolves.toBeUndefined();
    expect(createState).not.toHaveBeenCalled();
    expect(updateState).not.toHaveBeenCalled();
  });

  it('refuses to replace an already-initialized watermark', async () => {
    findState.mockResolvedValue({ dailyPublishedThrough: '20260730' });

    await expect(initializeDailyWatermark('20260729')).rejects.toThrow(
      'dailyPublishedThrough is already initialized to 20260730',
    );
  });
});

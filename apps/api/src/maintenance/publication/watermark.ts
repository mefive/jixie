import { prisma } from '#infra/database/prisma.js';

const STATE_KEY = 'global';

export async function getMaintenanceState(): Promise<{
  dailyPublishedThrough: string | null;
  weeklySyncedThrough: string | null;
  dataRevision: number;
}> {
  const row = await prisma.maintenanceState.findUnique({
    where: { key: STATE_KEY },
  });
  return {
    dailyPublishedThrough: row?.dailyPublishedThrough ?? null,
    weeklySyncedThrough: row?.weeklySyncedThrough ?? null,
    dataRevision: row?.dataRevision ?? 0,
  };
}

export async function initializeDailyWatermark(tradeDate: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const current = await transaction.maintenanceState.findUnique({
      where: { key: STATE_KEY },
    });
    if (!current) {
      await transaction.maintenanceState.create({
        data: { key: STATE_KEY, dailyPublishedThrough: tradeDate, dataRevision: 1 },
      });
      return;
    }
    if (current.dailyPublishedThrough === tradeDate) {
      return;
    }
    if (current.dailyPublishedThrough) {
      throw new Error(
        `dailyPublishedThrough is already initialized to ${current.dailyPublishedThrough}; use maintenance daily or maintenance repair`,
      );
    }
    await transaction.maintenanceState.update({
      where: { key: STATE_KEY },
      data: { dailyPublishedThrough: tradeDate, dataRevision: { increment: 1 } },
    });
  });
}

export async function advanceDailyWatermark(tradeDate: string): Promise<number> {
  const row = await prisma.$transaction(async (transaction) => {
    const current = await transaction.maintenanceState.findUnique({
      where: { key: STATE_KEY },
    });
    if (!current) {
      return transaction.maintenanceState.create({
        data: { key: STATE_KEY, dailyPublishedThrough: tradeDate, dataRevision: 1 },
      });
    }
    return transaction.maintenanceState.update({
      where: { key: STATE_KEY },
      data: {
        dailyPublishedThrough:
          !current.dailyPublishedThrough || tradeDate > current.dailyPublishedThrough
            ? tradeDate
            : current.dailyPublishedThrough,
        dataRevision: { increment: 1 },
      },
    });
  });
  return row.dataRevision;
}

export async function bumpDataRevision(): Promise<number> {
  const row = await prisma.maintenanceState.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, dataRevision: 1 },
    update: { dataRevision: { increment: 1 } },
  });
  return row.dataRevision;
}

export async function advanceWeeklyWatermark(date: string): Promise<number> {
  const row = await prisma.maintenanceState.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, weeklySyncedThrough: date, dataRevision: 1 },
    update: { weeklySyncedThrough: date, dataRevision: { increment: 1 } },
  });
  return row.dataRevision;
}

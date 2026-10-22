export interface RepairMaintenanceOptions {
  startDate?: string;
  endDate?: string;
  deferPublication?: boolean;
}

/** 在复制候选库之前拒绝旧选项和无效区间。 / Reject obsolete flags and invalid ranges before copying a candidate. */
export function parseRepairArguments(args: string[]): RepairMaintenanceOptions {
  if (args.includes('--refresh')) {
    throw new Error('Repair always refreshes the requested range; remove --refresh.');
  }
  if (
    (args.length !== 0 && args.length !== 2) ||
    args.some((argument) => !/^\d{8}$/.test(argument)) ||
    (args.length === 2 && args[0] > args[1])
  ) {
    throw new Error('Usage: pnpm maintenance repair [YYYYMMDD YYYYMMDD]');
  }

  return { startDate: args[0], endDate: args[1] };
}

import { acquireMarketReader, withMaintenanceLock } from './market-access.js';

const disconnected = () => process.exit(1);
process.once('disconnect', disconnected);
const hold = async () => {
  process.send?.({ type: 'ready' });
  await new Promise<void>((resolve) => process.once('message', () => resolve()));
};
try {
  if (process.argv[2] === 'reader') {
    const reader = await acquireMarketReader();
    try {
      await hold();
    } finally {
      await reader.release();
    }
  } else {
    await withMaintenanceLock(hold);
  }
} finally {
  process.removeListener('disconnect', disconnected);
  if (process.connected) {
    process.disconnect();
  }
}

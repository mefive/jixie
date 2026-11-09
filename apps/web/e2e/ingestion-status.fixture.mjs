/**
 * 当前采集状态的空闲夹具；覆盖项和水位不属于此契约。
 *
 * Provide an idle ingestion status fixture without retired coverage or watermark fields.
 */
export function idleIngestionStatus() {
  return {
    active: false,
    running: false,
    phase: 'idle',
    runId: null,
    kind: null,
    targetDate: null,
    stage: null,
    startedAt: null,
    heartbeatAt: null,
    error: null,
    retryAfterSeconds: 0,
    revision: 0,
    health: {
      latestRun: null,
      handling: {
        pending: { error: 0, warning: 0 },
        resolved: { error: 0, warning: 0 },
        accepted: { error: 0, warning: 0 },
      },
      unknownValidity: 0,
      coveredHistorical: 0,
      missingResolutionRecords: 0,
    },
  };
}

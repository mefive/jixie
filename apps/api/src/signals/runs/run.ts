import { projectSignals } from './projection.js';
import { prismaDataPort } from '#engine/adapters/prisma-port.js';
import { t } from '#i18n/messages.js';
import { prisma } from '#infra/database/prisma.js';
import { StrategyFactor } from '#strategy/factors/factor.js';
import { StrategyExecution } from '#strategy/execution/execution.js';
import type { StrategyExecutionResult } from '#engine/types.js';
import { errorMessage } from '#infra/errors.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import { codeConfigSchema } from '@jixie/shared/api/strategy';
import type { BacktestConfig, Locale, ModelPositionSnapshot, SignalItem } from '@jixie/shared';
import { summarizeFactorInputs } from '../factor-inputs/summary.js';

export async function runSignal(
  runId: string,
  systemLog: (text: string) => void,
  userLog: UserLogSink,
) {
  let locale: Locale = 'zh';
  try {
    const run = await prisma.signalRun.findUnique({
      where: { id: runId },
      include: { deployment: true },
    });
    if (!run) {
      throw new Error('Signal run not found');
    }

    locale = run.deployment.locale === 'en' ? 'en' : 'zh';
    const config = codeConfigSchema.parse(run.deployment.config) as BacktestConfig;
    if (config.start >= run.tradeDate) {
      throw new Error('Deployment start date must be earlier than the signal date');
    }
    systemLog(t(locale, 'signalCaptureStart', { date: run.tradeDate, execDate: run.execDate }));

    // Existing deployments retain their frozen dependency after a Factor is archived. The lineage
    // assertion below still rejects code or identity drift before the signal is calculated.
    const prepared = await StrategyFactor.fromStrategySource(config.code, run.userId, 'signal');
    const deploymentDependencies = StrategyFactor.dependenciesFromJson(
      run.deployment.factorDependencies,
    );
    const runDependencies = StrategyFactor.dependenciesFromJson(run.factorDependencies);
    const execution = await StrategyExecution.create({
      code: config.code,
      language: config.language,
      locale,
      factors: prepared,
      dataPort: prismaDataPort,
      onLog: systemLog,
      onUserLog: userLog,
    });
    let output: StrategyExecutionResult;
    try {
      if (deploymentDependencies !== null && runDependencies !== null) {
        StrategyFactor.assertDependencies(deploymentDependencies, runDependencies);
      }
      // Legacy rows may have only one snapshot, or neither. Preserve their admission rules.
      StrategyFactor.assertDependencies(
        runDependencies ?? deploymentDependencies,
        execution.factorDependencies,
      );
      output = await execution.run({ ...config, end: run.tradeDate, retainFinalState: true });
    } finally {
      execution.close();
    }
    if (!output.finalState) {
      throw new Error('Final strategy state was not retained');
    }
    const projection = projectSignals(output.finalState);
    const codes = [
      ...new Set([
        ...projection.signals.map((signal) => signal.code),
        ...projection.modelPositions.map((position) => position.code),
      ]),
    ];
    const [stocks, etfs] = await Promise.all([
      prisma.stockBasic.findMany({
        where: { tsCode: { in: codes } },
        select: { tsCode: true, name: true },
      }),
      prisma.etfBasic.findMany({
        where: { tsCode: { in: codes } },
        select: { tsCode: true, name: true },
      }),
    ]);
    const names = new Map(
      [...stocks, ...etfs].map((instrument) => [instrument.tsCode, instrument.name]),
    );
    const signals: SignalItem[] = projection.signals.map((signal) => ({
      ...signal,
      name: names.get(signal.code) ?? signal.code,
    }));
    const modelPositions: ModelPositionSnapshot[] = projection.modelPositions.map((position) => ({
      ...position,
      name: names.get(position.code) ?? position.code,
    }));
    const factorInputs = summarizeFactorInputs(
      prepared.map((factor) => factor.toDependency()),
      projection.tradeDate,
      projection.factorObservations,
      [...signals.map((signal) => signal.code), ...modelPositions.map((position) => position.code)],
    );
    systemLog(t(locale, 'signalCaptureDone', { count: signals.length }));
    return {
      dataCutoff: projection.tradeDate,
      modelEquity: projection.modelEquity,
      modelCash: projection.modelCash,
      modelPositions,
      signals,
      factorInputs,
    };
  } catch (error) {
    // Preserve the deployment's locale when the worker reports a computation failure.
    throw new Error(errorMessage(error, locale), { cause: error });
  }
}

import { prismaDataPort } from '#engine/adapters/prisma-port.js';
import { t } from '#i18n/messages.js';
import { prisma } from '#infra/database/prisma.js';
import { prepareStrategyFactors } from '#strategy/factor-inputs/prepare.js';
import { runSandboxedSignalCapture } from '#strategy/execution/simulation.js';
import { errorMessage } from '#infra/errors.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import { codeConfigSchema } from '@jixie/shared/api/strategy';
import type { BacktestConfig, Locale, ModelPositionSnapshot, SignalItem } from '@jixie/shared';
import { factorDependenciesFromJson } from '#strategy/factor-inputs/lineage.js';
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
    const prepared = await prepareStrategyFactors(config.code, run.userId, 'signal');
    const deploymentDependencies = factorDependenciesFromJson(run.deployment.factorDependencies);
    const runDependencies = factorDependenciesFromJson(run.factorDependencies);
    const output = await runSandboxedSignalCapture(
      {
        ...config,
        end: run.tradeDate,
        locale,
        customFactors: prepared.modules,
        factorDependencies: prepared.factors,
        factorDependencySnapshots: [deploymentDependencies, runDependencies],
      },
      prismaDataPort,
      systemLog,
      userLog,
    );
    const codes = [
      ...new Set([
        ...output.capture.signals.map((signal) => signal.code),
        ...output.capture.modelPositions.map((position) => position.code),
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
    const signals: SignalItem[] = output.capture.signals.map((signal) => ({
      ...signal,
      name: names.get(signal.code) ?? signal.code,
    }));
    const modelPositions: ModelPositionSnapshot[] = output.capture.modelPositions.map(
      (position) => ({
        ...position,
        name: names.get(position.code) ?? position.code,
      }),
    );
    const factorInputs = summarizeFactorInputs(
      prepared.factors,
      output.capture.tradeDate,
      output.capture.factorObservations,
      [...signals.map((signal) => signal.code), ...modelPositions.map((position) => position.code)],
    );
    systemLog(t(locale, 'signalCaptureDone', { count: signals.length }));
    return {
      dataCutoff: output.capture.tradeDate,
      modelEquity: output.capture.modelEquity,
      modelCash: output.capture.modelCash,
      modelPositions,
      signals,
      factorInputs,
    };
  } catch (error) {
    // Preserve the deployment's locale when the worker reports a computation failure.
    throw new Error(errorMessage(error, locale), { cause: error });
  }
}

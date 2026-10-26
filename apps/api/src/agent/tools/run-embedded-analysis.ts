import { z } from 'zod';
import { ulid } from 'ulid';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  EmbeddedAnalysisPart,
  ResearchEmbeddedContextV1,
  ResearchDataReferenceV1,
  ResearchEmbeddedRunV1,
} from '@jixie/shared';
import {
  embeddedDraftSchema,
  embeddedCreateSchema,
  embeddedUpdateSchema,
  embeddedRunSchema,
} from '@jixie/shared/api/research';
import { createEmbeddedAnalysis, updateEmbeddedVersion } from '#research/embedded/versions.js';
import {
  getEmbeddedAnalysis,
  getEmbeddedVersion,
  getEmbeddedRun,
} from '#research/embedded/read.js';
import { submitEmbeddedRun } from '#research/embedded/submit.js';
import { cancelEmbeddedRun } from '#research/embedded/cancel.js';
import type { AgentTool } from './types.js';

/**
 * 绑定嵌入式分析的版本、用户与会话归属，约束工具执行范围。
 *
 * Bind embedded analysis to its authorized user, version and conversation.
 */
export interface EmbeddedAnalysisToolContext {
  userId: string;
  source: ResearchEmbeddedContextV1;
  dataReferences?: ResearchDataReferenceV1[];
}
const parentSchema = z.strictObject({
  analysisId: z.string().min(1),
  versionId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});
const runSchema = embeddedDraftSchema.omit({ reportId: true }).extend({
  title: z.string().trim().min(1).max(120),
  parent: parentSchema.optional(),
});
const readSchema = z.strictObject({ analysisId: z.string().min(1), runId: z.string().min(1) });

/**
 * 为已授权实体构造嵌入式分析工具，复用研究执行和证据留存能力。
 *
 * Construct authorized embedded-analysis tools using editable drafts and current results.
 */
export function embeddedAnalysisTools(context: EmbeddedAnalysisToolContext): AgentTool[] {
  let attempts = 0;
  const assertHost = async (analysisId: string) => {
    const analysis = await getEmbeddedAnalysis(context.userId, analysisId);
    if (
      analysis.host.type !== context.source.host.type ||
      analysis.host.id !== context.source.host.id
    ) {
      throw new Error('This analysis belongs to a different Factor or Strategy');
    }
    return analysis;
  };
  return [
    {
      name: 'runEmbeddedAnalysis',
      description:
        'Execute one self-contained Research Python analysis for the current Factor or Strategy. Query runtime.python and the exact SDK methods with searchResearchCatalog first. Analysis code remains editable after success. Pass the exact parent reference and expectedRevision from readEmbeddedAnalysis to change it. A new run replaces the previous result for that draft; old run IDs can become unavailable. Inputs and environment evidence are not retained. Continuation copies current code and fetches current data. Use explicit results.factor_report/backtest_report calls for the selected report; no report or previous Python variables are injected. Use print(...) for text. Only the last expression is captured as a table, value or charts.* result. Newly created Matplotlib figures are captured automatically at the end of the Cell; keep them open. No Jupyter/IPython display() function is provided. This is exploratory analysis of existing data: no formal evaluation, backtest, publication or account actions. At most four submissions per conversation turn. The resulting card is saved before waiting for execution.',
      parameters: z.toJSONSchema(runSchema),

      /**
       * 创建并执行嵌入式分析，将确切运行记录留存在当前对话中。
       *
       * Create and execute embedded analysis while retaining the exact run in the conversation.
       */
      async run(raw, execution) {
        const input = runSchema.parse(raw);
        execution?.signal?.throwIfAborted();
        if (!execution?.onEmbeddedAnalysis) {
          throw new Error(
            'Embedded execution requires a persisted Factor or Strategy conversation',
          );
        }
        if (++attempts > 4) {
          throw new Error(
            'Four analysis attempts have been submitted. Explain the results or failure before trying again.',
          );
        }
        const draft = {
          source: input.source,
          parameters: input.parameters,
          inputScope: input.inputScope,
          reportId: context.source.report?.id,
        };
        let analysisId: string;
        let version;
        if (input.parent) {
          const parent = input.parent;
          await assertHost(parent.analysisId);
          const previous = await getEmbeddedVersion(
            context.userId,
            parent.analysisId,
            parent.versionId,
          );
          if (previous.revision !== parent.expectedRevision) {
            throw new Error('The draft changed; read its current revision before retrying');
          }
          analysisId = parent.analysisId;
          version = await updateEmbeddedVersion(
            context.userId,
            analysisId,
            previous.id,
            embeddedUpdateSchema.parse({ ...draft, expectedRevision: previous.revision }),
          );
        } else {
          const created = await createEmbeddedAnalysis(
            context.userId,
            embeddedCreateSchema.parse({
              ...draft,
              title: input.title,
              host: context.source.host,
            }),
          );
          analysisId = created.analysis.id;
          version = created.version;
        }
        execution.signal?.throwIfAborted();
        const submitted = await submitEmbeddedRun(
          context.userId,
          analysisId,
          version.id,
          embeddedRunSchema.parse({
            requestId: ulid(),
            expectedRevision: version.revision,
          }),
        );
        const part: EmbeddedAnalysisPart = {
          type: 'embedded_analysis',
          title: input.title,
          reference: { analysisId, versionId: version.id, runId: submitted.runId },
        };
        await execution.onEmbeddedAnalysis(part);
        const deadline = Date.now() + 45_000;
        try {
          for (;;) {
            execution.signal?.throwIfAborted();
            const run = await getEmbeddedRun(context.userId, analysisId, submitted.runId);
            if (!['queued', 'running'].includes(run.status) || Date.now() >= deadline) {
              return {
                embeddedAnalysis: part,
                observation: embeddedObservation(run, version.number),
              };
            }
            await delay(250, undefined, { signal: execution.signal });
          }
        } catch (error) {
          if (execution.signal?.aborted) {
            await cancelEmbeddedRun(context.userId, analysisId, submitted.runId);
          }
          throw error;
        }
      },
    },
    {
      name: 'readEmbeddedAnalysis',
      description:
        'Read a still-retained embedded run named in a conversation card. Returns current editable code and parameters, run revision, status and bounded outputs. If currentRevision differs from the run revision, the result is stale and must be rerun; do not present current code as the source of an older output. Use this before changing a previous analysis or discussing its computed result.',
      parameters: z.toJSONSchema(readSchema),

      /**
       * 按绑定实体的分析上下文分派版本或运行读取，供工具观察。
       *
       * Dispatch embedded version or run reads under the bound entity context.
       */
      async run(raw) {
        const input = readSchema.parse(raw);
        await assertHost(input.analysisId);
        const run = await getEmbeddedRun(context.userId, input.analysisId, input.runId);
        const version = await getEmbeddedVersion(context.userId, input.analysisId, run.versionId);
        return {
          observation: embeddedObservation(run, version.number, version.revision),
        };
      },
    },
  ];
}

/**
 * 将嵌入式运行结果压缩为模型观察，保留执行与产物引用。
 *
 * Summarize an embedded run for the model while retaining execution and artifact references.
 */
function embeddedObservation(
  run: ResearchEmbeddedRunV1,
  versionNumber: number,
  currentRevision = run.currentRevision,
) {
  const outputs = run.outputs.map((output) => {
    if (output.type === 'image') {
      return { type: output.type, alt: output.alt, artifactId: output.artifactId };
    }
    const text = JSON.stringify(output);
    return text.length > 6_000
      ? { type: output.type, preview: text.slice(0, 6_000), truncated: true }
      : output;
  });
  const result = {
    analysisId: run.analysisId,
    versionId: run.versionId,
    runId: run.runId,
    versionNumber,
    currentRevision,
    revision: run.revision,
    status: run.status,
    source: run.source,
    parameters: run.parameters,
    inputScope: run.inputScope,
    limits: run.limits,
    errorCode: run.errorCode,
    error: run.error,
    outputs,
    note: 'Exploratory analysis; the card retains the complete bounded result. A queued/running result is not complete.',
  };
  if (JSON.stringify(result).length > 24_000) {
    const preview = {
      analysisId: run.analysisId,
      versionId: run.versionId,
      runId: run.runId,
      versionNumber,
      currentRevision,
      revision: run.revision,
      status: run.status,
      limits: run.limits,
      errorCode: run.errorCode,
      error: run.error?.slice(0, 2_000),
      sourcePreview: run.source.slice(0, 4_000),
      inputScopePreview: run.inputScope.slice(0, 1_000),
      outputPreview: JSON.stringify(outputs).slice(0, 6_000),
      previewTruncated: true,
      note: 'Current code, parameters and retained outputs are available in the card. This preview omits content; do not infer omitted values.',
    };
    while (JSON.stringify(preview).length > 24_000) {
      preview.sourcePreview = preview.sourcePreview.slice(
        0,
        Math.floor(preview.sourcePreview.length / 2),
      );
      preview.outputPreview = preview.outputPreview.slice(
        0,
        Math.floor(preview.outputPreview.length / 2),
      );
      preview.inputScopePreview = preview.inputScopePreview.slice(
        0,
        Math.floor(preview.inputScopePreview.length / 2),
      );
      preview.error = preview.error?.slice(0, Math.floor(preview.error.length / 2));
    }
    return JSON.stringify(preview);
  }
  return JSON.stringify(result);
}

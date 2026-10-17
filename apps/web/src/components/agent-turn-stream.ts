import { makeObservable, observable, runInAction } from 'mobx';
import type {
  EmbeddedAnalysisPart,
  AgentStreamEvent,
  AgentTurnPhase,
  MessagePart,
  ToolTraceItem,
} from '@jixie/shared';
import { cancelAgentTurn, findRunningAgentTurn, readSSE, subscribeAgentTurn } from '@src/api/agent';
import i18n from '@src/i18n';

/**
 * 封装轮次完成结果，供业务 store 更新消息和产物。
 *
 * Carry terminal turn results into store message and artifact updates.
 */
export interface AgentTurnDone {
  turnId: string;
  parts: MessagePart[];
  code: string;
  changed: boolean;
  toolTrace: ToolTraceItem[];
}

/**
 * 定义流式轮次增量与终态回调，供各工作台复用。
 *
 * Define incremental and terminal callbacks shared by workspace streams.
 */
export interface AgentTurnHandlers {
  onEmbeddedAnalysis?(part: EmbeddedAnalysisPart, turnId: string): void;
  onDone(done: AgentTurnDone): void;
  onError(message: string): void;
  onCancelled?(): void;
}

/**
 * Client side of one streaming agent turn (owned by a page store, one per chat surface). attach()
 * subscribes to a turnId's SSE stream and mirrors it into observables the pending bubble renders;
 * the first frame is always the server's snapshot, so attaching to an already-running turn (page
 * refresh → attachRunning) replaces local state and continues seamlessly. Terminal events land in
 * the handlers; the store appends the final message / applies code there.
 */
export class AgentTurnStream {
  public streaming = false;
  public text = ''; // accumulated produce-phase text (pending bubble body)
  public reasoning = '';
  public trace: ToolTraceItem[] = []; // completed tool calls so far
  public statusNote = ''; // transient phase line: querying X… / fixing…
  public phase: AgentTurnPhase | null = null;
  public turnId: string | null = null;

  private abortController: AbortController | null = null;

  public constructor() {
    makeObservable(this, {
      streaming: observable.ref,
      text: observable.ref,
      reasoning: observable.ref,
      trace: observable.ref,
      statusNote: observable.ref,
      phase: observable.ref,
      turnId: observable.ref,
    });
  }

  /**
   * 订阅轮次并处理事件直到终态，终态后 Promise 完成。
   *
   * Subscribe to a turn and pump events until a terminal one. Resolves after the terminal event.
   */
  public async attach(turnId: string, handlers: AgentTurnHandlers): Promise<void> {
    this.detach(); // a store drives at most one live subscription
    const controller = new AbortController();
    this.abortController = controller;
    runInAction(() => {
      this.streaming = true;
      this.turnId = turnId;
      this.text = '';
      this.reasoning = '';
      this.trace = [];
      this.statusNote = '';
      this.phase = null;
    });

    try {
      const res = await subscribeAgentTurn(turnId, controller.signal);
      for await (const ev of readSSE(res)) {
        if (this.applyEvent(ev, handlers)) {
          break; // terminal
        }
      }
    } catch (e) {
      // A deliberate detach (store cleanup / re-attach) aborts the fetch — not an error.
      if (!controller.signal.aborted) {
        handlers.onError(
          e instanceof Error ? e.message : i18n.t('components:streamConnectionFailed'),
        );
      }
    } finally {
      if (this.turnId === turnId) {
        runInAction(() => {
          this.streaming = false;
          this.statusNote = '';
          this.phase = null;
        });
      }
    }
  }

  /**
   * 刷新时查找并重连实体活动轮次，无活动轮次时保持原状态。
   *
   * Refresh reattach: look up the entity's live turn and attach if there is one. Like attach(),
   * resolves only after the terminal event — callers gate their `sending` flag on it.
   */
  public async attachRunning(entityKey: string, handlers: AgentTurnHandlers): Promise<boolean> {
    const turnId = await this.findRunning(entityKey);
    if (!turnId) {
      return false;
    }
    await this.attach(turnId, handlers);
    return true;
  }

  /**
   * 查询活动轮次而不改变已渲染流状态。
   *
   * Resolve the live turn without changing rendered stream state.
   */
  public async findRunning(entityKey: string): Promise<string | null> {
    try {
      const { turnId } = await findRunningAgentTurn(entityKey);
      return turnId;
    } catch {
      return null; // discovery is best-effort — the persisted conversation is already shown
    }
  }

  /**
   * 在服务端取消轮次，上游 LLM 被中断并产生 cancelled 终态。
   *
   * Stop the TURN server-side (the upstream LLM aborts; the stream ends with `cancelled`).
   */
  public cancel(): void {
    if (this.turnId && this.streaming) {
      void cancelAgentTurn(this.turnId).catch(() => {});
    }
  }

  /**
   * 只断开当前订阅，服务端轮次继续运行。
   *
   * Drop the SUBSCRIPTION only (store cleanup / page switch) — the turn keeps running server-side.
   */
  public detach(): void {
    this.abortController?.abort();
    this.abortController = null;
    runInAction(() => {
      this.streaming = false;
      this.turnId = null;
      this.text = '';
      this.reasoning = '';
      this.trace = [];
      this.statusNote = '';
      this.phase = null;
    });
  }

  /**
   * 将单个事件映射到可观察状态，返回是否终态供停止读取。
   *
   * Mirror one event into the observables; true = terminal (stop pumping).
   */
  private applyEvent(ev: AgentStreamEvent, handlers: AgentTurnHandlers): boolean {
    switch (ev.type) {
      case 'snapshot':
        for (const part of ev.embeddedAnalyses ?? []) {
          handlers.onEmbeddedAnalysis?.(part, this.turnId ?? '');
        }
        runInAction(() => {
          this.text = ev.text;
          this.trace = ev.trace;
          this.reasoning = ev.reasoning ?? '';
          this.phase = ev.phase ?? null;
          this.statusNote = ev.phase ? phaseNote(ev.phase) : '';
        });
        return false;
      case 'embedded_analysis':
        handlers.onEmbeddedAnalysis?.(ev.part, this.turnId ?? '');
        return false;
      case 'delta':
        runInAction(() => {
          this.text = this.text + ev.text;
        });
        return false;
      case 'reasoning_delta':
        runInAction(() => {
          this.reasoning = this.reasoning + ev.text;
        });
        return false;
      case 'phase':
        runInAction(() => {
          this.phase = ev.phase;
          this.statusNote = phaseNote(ev.phase);
        });
        return false;
      case 'tool_start':
        runInAction(() => {
          if (this.phase !== 'awaiting_review') {
            this.statusNote = i18n.t('components:queryingTool', { name: ev.name });
          }
        });
        return false;
      case 'tool_done':
        runInAction(() => {
          this.trace = [...this.trace, ev.item];
          this.statusNote = this.phase ? phaseNote(this.phase) : '';
        });
        return false;
      case 'repair':
        runInAction(() => {
          this.statusNote = i18n.t('components:repairingCode', { round: ev.round });
        });
        return false;
      case 'done':
        handlers.onDone({
          turnId: this.turnId ?? '',
          parts: ev.parts,
          code: ev.code,
          changed: ev.changed,
          toolTrace: ev.toolTrace,
        });
        return true;
      case 'error':
        handlers.onError(ev.message);
        return true;
      case 'cancelled':
        handlers.onCancelled?.();
        return true;
    }
  }
}

function phaseNote(phase: AgentTurnPhase): string {
  return i18n.t(`components:agentPhase.${phase}`);
}

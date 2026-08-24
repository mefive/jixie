import { makeObservable, observable, runInAction } from 'mobx';
import type { AgentStreamEvent, AgentTurnPhase, MessagePart, ToolTraceItem } from '@jixie/shared';
import {
  cancelAgentTurn,
  findRunningAgentTurn,
  readSSE,
  subscribeAgentTurn,
} from '@src/api/client';
import i18n from '@src/i18n';

export interface AgentTurnDone {
  turnId: string;
  parts: MessagePart[];
  code: string;
  changed: boolean;
  toolTrace: ToolTraceItem[];
}

export interface AgentTurnHandlers {
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

  /** Subscribe to a turn and pump events until a terminal one. Resolves after the terminal event. */
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

  /** Refresh reattach: look up the entity's live turn and attach if there is one. Like attach(),
   * resolves only after the terminal event — callers gate their `sending` flag on it. */
  public async attachRunning(entityKey: string, handlers: AgentTurnHandlers): Promise<boolean> {
    const turnId = await this.findRunning(entityKey);
    if (!turnId) {
      return false;
    }
    await this.attach(turnId, handlers);
    return true;
  }

  /** Resolve the live turn without changing rendered stream state. */
  public async findRunning(entityKey: string): Promise<string | null> {
    try {
      const { turnId } = await findRunningAgentTurn(entityKey);
      return turnId;
    } catch {
      return null; // discovery is best-effort — the persisted conversation is already shown
    }
  }

  /** Stop the TURN server-side (the upstream LLM aborts; the stream ends with `cancelled`). */
  public cancel(): void {
    if (this.turnId && this.streaming) {
      void cancelAgentTurn(this.turnId).catch(() => {});
    }
  }

  /** Drop the SUBSCRIPTION only (store cleanup / page switch) — the turn keeps running server-side. */
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

  /** Mirror one event into the observables; true = terminal (stop pumping). */
  private applyEvent(ev: AgentStreamEvent, handlers: AgentTurnHandlers): boolean {
    switch (ev.type) {
      case 'snapshot':
        runInAction(() => {
          this.text = ev.text;
          this.trace = ev.trace;
          this.reasoning = ev.reasoning ?? '';
          this.phase = ev.phase ?? null;
          this.statusNote = ev.phase ? phaseNote(ev.phase) : '';
        });
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

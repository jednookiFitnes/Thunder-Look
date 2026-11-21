export type TaskPriority = "high" | "normal" | "low";

export interface EnqueueOptions {
  priority?: TaskPriority;
  signal?: AbortSignal;
  timeoutMs?: number;
  tag?: string;
}

interface QueuedTask<T> {
  id: number;
  priority: TaskPriority;
  tag?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  abortHandler?: () => void;
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export class TaskTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Operacja przekroczyła limit czasu (${Math.round(timeoutMs / 1000)} s).`);
    this.name = "TaskTimeoutError";
  }
}

/**
 * Kolejka priorytetowa (serializacja operacji na pojedynczej sesji IMAP):
 * - Zadania "high" (kliknięcie maila, akcje użytkownika) wyprzedzają "normal" i "low" (prefetch, NOOP).
 * - Anulowanie sygnałem AbortSignal natychmiast usuwa oczekujące zadanie z kolejki.
 * - Twardy timeout per zadanie chroni przed zakleszczeniem (deadlockiem) kolejki na zawieszonym gnieździe.
 */
export class PriorityTaskQueue {
  private pending: Array<QueuedTask<unknown>> = [];
  private running = false;
  private nextId = 1;

  get pendingCount(): number {
    return this.pending.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  enqueue<T>(run: () => Promise<T>, options?: EnqueueOptions): Promise<T> {
    const priority: TaskPriority = options?.priority ?? "normal";
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs;
    const tag = options?.tag;

    if (signal?.aborted) {
      return Promise.reject(new Error("ABORTED"));
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: this.nextId++,
        priority,
        tag,
        signal,
        timeoutMs,
        run,
        resolve,
        reject,
      };

      if (signal) {
        const onAbort = () => {
          const idx = this.pending.indexOf(task as QueuedTask<unknown>);
          if (idx !== -1) {
            this.pending.splice(idx, 1);
            reject(new Error("ABORTED"));
          }
        };
        task.abortHandler = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }

      // Wstaw z zachowaniem priorytetu i FIFO wewnątrz tego samego priorytetu
      const w = PRIORITY_WEIGHT[priority];
      let insertIdx = this.pending.length;
      for (let i = 0; i < this.pending.length; i++) {
        if (PRIORITY_WEIGHT[this.pending[i].priority] > w) {
          insertIdx = i;
          break;
        }
      }
      this.pending.splice(insertIdx, 0, task as QueuedTask<unknown>);
      this.drain();
    });
  }

  /**
   * Natychmiast odrzuca i usuwa z kolejki wszystkie oczekujące zadania o wskazanym tagu (np. "prefetch").
   */
  cancelPendingByTag(tag: string): number {
    let removed = 0;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const task = this.pending[i];
      if (task.tag === tag) {
        this.pending.splice(i, 1);
        if (task.signal && task.abortHandler) {
          task.signal.removeEventListener("abort", task.abortHandler);
        }
        task.reject(new Error("ABORTED"));
        removed++;
      }
    }
    return removed;
  }

  clearAllPending(reason = "ABORTED"): void {
    const items = this.pending.splice(0, this.pending.length);
    for (const task of items) {
      if (task.signal && task.abortHandler) {
        task.signal.removeEventListener("abort", task.abortHandler);
      }
      task.reject(new Error(reason));
    }
  }

  private drain(): void {
    if (this.running) return;
    const next = this.pending.shift();
    if (!next) return;

    if (next.signal && next.abortHandler) {
      next.signal.removeEventListener("abort", next.abortHandler);
    }
    if (next.signal?.aborted) {
      next.reject(new Error("ABORTED"));
      this.drain();
      return;
    }

    this.running = true;
    void this.executeTask(next).finally(() => {
      this.running = false;
      this.drain();
    });
  }

  private async executeTask<T>(task: QueuedTask<T>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      let result: T;
      if (task.timeoutMs && task.timeoutMs > 0) {
        result = await Promise.race([
          task.run(),
          new Promise<never>((_res, rej) => {
            timer = setTimeout(() => rej(new TaskTimeoutError(task.timeoutMs!)), task.timeoutMs);
          }),
        ]);
      } else {
        result = await task.run();
      }
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

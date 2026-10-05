// Undo/redo over invertible commands. Generic: each planner supplies its own state type, command type, and `apply`/`inverse`.
export interface History<S, C> {
  /** Only after a successful commit. Clears the redo branch. `label` is the human action name (B9). */
  push(command: C, label?: string): void;
  /** Applies the inverse of the newest command. `null` when empty. */
  undo(state: S): S | null;
  /** Re-applies the next undone command. `null` when at newest. */
  redo(state: S): S | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Label of the entry the next undo / redo would act on (B9: "Undo · Move Sofa"). */
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
}

export interface HistoryJSON<C> {
  done: C[];
  undone: C[];
  doneLabels?: Array<string | null>;
  undoneLabels?: Array<string | null>;
}

export interface CommandAlgebra<S, C> {
  apply(command: C, state: S): S;
  inverse(command: C): C;
}

export class CommandHistoryOf<S, C> implements History<S, C> {
  protected done: C[] = [];
  protected undone: C[] = [];
  protected doneLabels: Array<string | undefined> = [];
  protected undoneLabels: Array<string | undefined> = [];

  constructor(protected readonly algebra: CommandAlgebra<S, C>) {}

  push(command: C, label?: string): void {
    this.done.push(command);
    this.doneLabels.push(label);
    this.undone = [];
    this.undoneLabels = [];
  }

  undo(state: S): S | null {
    const cmd = this.done[this.done.length - 1];
    if (!cmd) return null;
    const next = this.algebra.apply(this.algebra.inverse(cmd), state);
    this.done.pop();
    this.undone.push(cmd);
    this.undoneLabels.push(this.doneLabels.pop());
    return next;
  }

  redo(state: S): S | null {
    const cmd = this.undone[this.undone.length - 1];
    if (!cmd) return null;
    const next = this.algebra.apply(cmd, state);
    this.undone.pop();
    this.done.push(cmd);
    this.doneLabels.push(this.undoneLabels.pop());
    return next;
  }

  canUndo(): boolean { return this.done.length > 0; }
  canRedo(): boolean { return this.undone.length > 0; }
  get length(): number { return this.done.length; }
  undoLabel(): string | undefined { return this.doneLabels[this.doneLabels.length - 1]; }
  redoLabel(): string | undefined { return this.undoneLabels[this.undoneLabels.length - 1]; }

  /** Commands are plain JSON-serialisable data. */
  toJSON(): HistoryJSON<C> {
    return {
      done: structuredClone(this.done),
      undone: structuredClone(this.undone),
      doneLabels: this.doneLabels.map((l) => l ?? null),
      undoneLabels: this.undoneLabels.map((l) => l ?? null),
    };
  }

  protected load(data: HistoryJSON<C>): void {
    this.done = structuredClone(data.done);
    this.undone = structuredClone(data.undone);
    this.doneLabels = this.done.map((_, i) => data.doneLabels?.[i] ?? undefined);
    this.undoneLabels = this.undone.map((_, i) => data.undoneLabels?.[i] ?? undefined);
  }
}

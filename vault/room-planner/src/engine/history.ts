import { apply, inverse } from './commands';
import type { Command, Project } from './types';

export interface History {
  /** Only after a successful commit. Clears the redo branch. */
  push(command: Command): void;
  /** Applies the inverse of the newest command. `null` when empty. */
  undo(state: Project): Project | null;
  /** Re-applies the next undone command. `null` when at newest. */
  redo(state: Project): Project | null;
  canUndo(): boolean;
  canRedo(): boolean;
}

export class CommandHistory implements History {
  private done: Command[] = [];
  private undone: Command[] = [];

  push(command: Command): void {
    this.done.push(command);
    this.undone = [];
  }

  undo(state: Project): Project | null {
    const cmd = this.done[this.done.length - 1];
    if (!cmd) return null;
    const next = apply(inverse(cmd), state);
    this.done.pop();
    this.undone.push(cmd);
    return next;
  }

  redo(state: Project): Project | null {
    const cmd = this.undone[this.undone.length - 1];
    if (!cmd) return null;
    const next = apply(cmd, state);
    this.undone.pop();
    this.done.push(cmd);
    return next;
  }

  canUndo(): boolean { return this.done.length > 0; }
  canRedo(): boolean { return this.undone.length > 0; }
  get length(): number { return this.done.length; }

  /** Commands are plain JSON-serialisable data. */
  toJSON(): { done: Command[]; undone: Command[] } {
    return { done: structuredClone(this.done), undone: structuredClone(this.undone) };
  }

  static fromJSON(data: { done: Command[]; undone: Command[] }): CommandHistory {
    const h = new CommandHistory();
    h.done = structuredClone(data.done);
    h.undone = structuredClone(data.undone);
    return h;
  }
}

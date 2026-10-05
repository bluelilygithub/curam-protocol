import { CommandHistoryOf, type History as HistoryOf, type HistoryJSON as HistoryJSONOf } from '@planner-core/engine/history';
import { apply, inverse } from './commands';
import type { Command, Project } from './types';

export type History = HistoryOf<Project, Command>;
export type HistoryJSON = HistoryJSONOf<Command>;

/** Room Planner's undo history: the shared implementation bound to the room commands. */
export class CommandHistory extends CommandHistoryOf<Project, Command> {
  constructor() { super({ apply, inverse }); }

  static fromJSON(data: HistoryJSON): CommandHistory {
    const h = new CommandHistory();
    h.load(data);
    return h;
  }
}

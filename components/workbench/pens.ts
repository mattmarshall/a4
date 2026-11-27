/**
 * Which pens the Models section offers, and in what order: Fit to page first,
 * then each installed plugin that declares Transform, by name. The pens hook
 * and its test share it.
 */

import { FIT_TO_PAGE, type ModelCard, Operation } from "../../lib/models/index.ts";

/** A pen's card, and who published it: its publisher note, or null when it's built in. */
export interface PenSource {
  readonly card: ModelCard;
  readonly publisher: string | null;
}

/** Fit to page, then each installed plugin in `installed` that writes pages, by name. */
export function penCards(installed: readonly PenSource[]): readonly PenSource[] {
  return [
    { card: FIT_TO_PAGE.card, publisher: null },
    ...installed
      .filter((p) => p.card.operations.includes(Operation.TRANSFORM))
      .sort((a, b) => a.card.name.localeCompare(b.card.name)),
  ];
}

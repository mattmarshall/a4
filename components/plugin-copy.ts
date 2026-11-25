/**
 * Model plugins in English: what a plugin does, where it sends page text,
 * what it downloads and asks for, and who published it. The Models section,
 * the install dialog, and `a4 plugin verify` all say these things, so they say
 * them the same way.
 *
 * Like desk-copy.ts, it imports lib/ by relative path, so the `a4` command
 * can load it under Node without the app's path aliases.
 */

import { type Inspection, type ModelCard, Operation, remoteHost, type UpdateChanges } from "../lib/models/index.ts";

/** "38.0 MB" (decimal megabytes, as download sizes are usually given), or "12 KB" under a megabyte. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Where a plugin runs, and whether page text leaves the device. */
export function whereItRuns(card: ModelCard): string {
  const host = remoteHost(card);
  if (host !== null) return `Sends the page to ${host}, only after you confirm each request`;
  return "Runs in your browser; page text stays on this device";
}

/** What kind of plugin a card describes: a pen writes, an overlay scores. */
export function pluginKind(card: ModelCard): string {
  const pen = card.operations.includes(Operation.TRANSFORM);
  const overlay = card.operations.includes(Operation.SCORE);
  if (pen && overlay) return "A pen and an overlay: it writes new pages and tints yours";
  if (pen) return "A pen: it writes a new page from yours, and never changes yours";
  return "An overlay: it scores your page and tints it";
}

/** What a plugin downloads before first use. */
export function downloadNote(card: ModelCard): string {
  const bytes = Number(card.downloadBytes);
  if (bytes <= 0) return "Downloads nothing";
  return `Downloads ${formatBytes(bytes)} of model files, only after you ask`;
}

/** The credentials a plugin asks the author for. */
export function credentialNote(card: ModelCard): string {
  if (card.credentials.length === 0) return "Asks for no credentials";
  return `Asks for: ${card.credentials.map((c) => c.label || c.kind).join(", ")}`;
}

/**
 * Who published a plugin: a known publisher's listed name, or the name an
 * unknown one gives itself, marked as its own.
 */
export function publisherNote(knownName: string | null, givenName: string): string {
  if (knownName !== null) return `Known publisher: ${knownName}`;
  return `Unknown publisher (calls itself “${givenName}”)`;
}

/** What a pen's result page is called after: "<source> (fit)" for Fit to page, "<source> (<pen name>)" otherwise. */
export function penSuffix(card: ModelCard): string {
  return card.id === "fit-to-page" ? " (fit)" : ` (${card.name})`;
}

/** One row of the install dialog. */
interface DialogRow {
  readonly label: string;
  readonly value: string;
}

/** What the install or update dialog says about a checked package. */
export interface InstallDialogCopy {
  readonly title: string;
  readonly rows: readonly DialogRow[];
  /** For an update: what changes from the installed version, a sentence each. */
  readonly changes: readonly string[];
  readonly confirm: string;
}

function destinationChange(change: NonNullable<UpdateChanges["destination"]>): string {
  if (change.after === null) return "It will now keep page text on this device.";
  if (change.before === null)
    return `It will now send page text to ${change.after}, only after you confirm each request.`;
  return `It will send page text to ${change.after} instead of ${change.before}.`;
}

/** The install or update dialog for `inspection`, in words. */
export function installDialog(inspection: Inspection): InstallDialogCopy {
  const { card, publisher } = inspection.pkg;
  const rows: DialogRow[] = [
    { label: "Does", value: pluginKind(card) },
    { label: "Page text", value: whereItRuns(card) },
    { label: "Downloads", value: downloadNote(card) },
    { label: "Credentials", value: credentialNote(card) },
    { label: "Publisher", value: publisherNote(inspection.known?.name ?? null, publisher.name) },
    { label: "Fingerprint", value: publisher.fingerprint },
    { label: "From", value: inspection.sourceUrl || "A file you chose" },
  ];
  if (card.description) rows.unshift({ label: "About", value: card.description });
  const changes: string[] = [];
  const { destination, downloadBytes, credentials } = inspection.changes;
  if (destination) changes.push(destinationChange(destination));
  if (downloadBytes) {
    changes.push(
      `Its download changes from ${formatBytes(Number(downloadBytes.before))} to ${formatBytes(Number(downloadBytes.after))}.`,
    );
  }
  if (credentials) {
    changes.push(
      credentials.after.length > 0
        ? `It now asks for: ${credentials.after.join(", ")}.`
        : "It no longer asks for credentials.",
    );
  }
  const update = inspection.kind === "update" && inspection.previous;
  return {
    title: update
      ? `Update ${card.name} from ${inspection.previous?.version} to ${card.version}?`
      : `Install ${card.name} ${card.version}?`,
    rows,
    changes,
    confirm: update ? "Update" : "Install",
  };
}

/**
 * Model plugins in English: what a plugin does, where it sends page text,
 * what it downloads and asks for, and who published it. The Models section,
 * a pen's panel, the install and consent dialogs, and `a4 plugin verify` all
 * say these things, so they say them the same way. Fit to page's own wording
 * is here too, keyed on its card's id, so the card format needn't carry it.
 *
 * Like desk-copy.ts, it imports lib/ by relative path, so the `a4` command
 * can load it under Node without the app's path aliases.
 */

import {
  type CredentialRequirement,
  FIT_TO_PAGE,
  type Inspection,
  type ModelCard,
  Operation,
  remoteHost,
  type UpdateChanges,
} from "../lib/models/index.ts";

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

const isFitToPage = (card: ModelCard) => card.id === FIT_TO_PAGE.card.id;

/** What a pen's result page is called after: "<source> (fit)" for Fit to page, "<source> (<pen name>)" otherwise. */
export function penSuffix(card: ModelCard): string {
  return isFitToPage(card) ? " (fit)" : ` (${card.name})`;
}

/** A running rewrite, on the top bar's chip: “Fitting “Brief””, or the pen's name and the page's. */
export function penProgress(card: ModelCard, pageName: string): string {
  return isFitToPage(card) ? `Fitting “${pageName}”` : `${card.name}: “${pageName}”`;
}

/** What the author calls a credential: its label, or its kind when it has none. */
function credentialLabel(credential: CredentialRequirement): string {
  return credential.label || credential.kind;
}

/** "a", "a or b", "a, b, or c". */
function orList(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" or ");
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}

/** A rewrite in progress, as the pen panel shows it. */
interface RewriteProgress {
  readonly name: string;
  readonly attempt: number;
  readonly maxAttempts: number | null;
  readonly characters: number;
}

/** What a pen's panel says. */
export interface PenPanelCopy {
  /** The Run button for the page `pageName`, with the instruction the author chose. */
  run(pageName: string, instruction: string): string;
  /** The line while a rewrite runs. */
  progress(phase: RewriteProgress): string;
  /** The prompt beside a credential's field. */
  credentialPrompt(credential: CredentialRequirement): string;
  /** The line while a credential is set. */
  credentialSet(credential: CredentialRequirement): string;
  /** What a run costs the author, or null when A4 can't say. */
  readonly cost: string | null;
  /** A hint in a credential's field, or null. */
  readonly placeholder: string | null;
  readonly useKey: string;
  readonly forgetKey: string;
}

/** What `card`'s pen panel says: Fit to page in its own words, any other pen in the shared ones. */
export function penPanel(card: ModelCard): PenPanelCopy {
  const fit = isFitToPage(card);
  const host = remoteHost(card);
  return {
    run: (pageName, instruction) =>
      fit ? `Fit “${pageName}” to the page` : `${instruction || card.name}: “${pageName}”`,
    progress: ({ name, attempt, maxAttempts, characters }) =>
      `${fit ? `Claude is rewriting “${name}”` : `${card.name} is writing “${name}”`} · attempt ${attempt}${
        maxAttempts === null ? "" : ` of ${maxAttempts}`
      } · ${characters.toLocaleString("en-US")} characters`,
    credentialPrompt: (credential) =>
      `Your ${credentialLabel(credential)}. It’s kept in this tab’s memory only, never saved, and forgotten when you reload. It goes only to ${host ?? "this plugin"}.`,
    credentialSet: (credential) => `Your ${credentialLabel(credential)} is set for this tab only.`,
    cost: fit ? "Billed to your key: usually a few cents, up to about $0.50 with retries." : null,
    placeholder: fit ? "sk-ant-…" : null,
    useKey: "Use key",
    forgetKey: "Forget key",
  };
}

/** A call waiting for the author to confirm it: a pen's rewrite or a remote overlay's score. */
export interface ConsentRequest {
  readonly card: ModelCard;
  /** Who published the plugin (its publisher note), for an installed one; null when it's built in. */
  readonly publisher: string | null;
  readonly pageName: string;
  readonly characters: number;
  readonly action: "score" | "rewrite";
}

/** One row of a dialog. A row with `code` shows it first, as code, then `value`. */
interface DialogRow {
  readonly label: string;
  readonly code?: string;
  readonly value: string;
}

/** What the consent dialog says about one call. */
export interface ConsentDialogCopy {
  readonly title: string;
  readonly rows: readonly DialogRow[];
  readonly note: string;
}

/**
 * The consent dialog for `request`: where the page goes, which plugin sends
 * it, the model, the page and its characters, what stays out of A4's server,
 * and what happens next. Every remote call is confirmed in these words.
 */
export function consentDialog(request: ConsentRequest): ConsentDialogCopy {
  const { card } = request;
  const fit = isFitToPage(card);
  const host = remoteHost(card) ?? "";
  const rows: DialogRow[] = [
    { label: "Destination", code: host, value: `${fit ? " (Anthropic)" : ""}, directly from this browser.` },
    {
      label: "Plugin",
      value: fit
        ? "Fit to page, built into A4"
        : `${card.name} ${card.version}${request.publisher ? ` · ${request.publisher}` : ""}`,
    },
  ];
  if (card.model) {
    rows.push({
      label: "Model",
      code: card.model,
      value: fit ? ". If Claude declines, Anthropic may retry the request with a fallback model." : "",
    });
  }
  rows.push({
    label: "Page",
    value: `“${request.pageName}”, ${request.characters.toLocaleString("en-US")} characters`,
  });
  const credentials = card.credentials.map(credentialLabel);
  const server = `A4’s server never sees the page${credentials.length > 0 ? ` or your ${orList(credentials)}` : ""}.`;
  const next =
    request.action === "rewrite"
      ? "The rewrite opens as a new page in Compare. This page doesn’t change. You’ll be asked again next time."
      : "The scores tint this page as a lens. You’ll be asked again before it scores the page again.";
  return {
    title: `Send this page to ${fit ? "Anthropic" : host}?`,
    rows,
    note: `${server} ${next}`,
  };
}

/** What the Models section says, beyond each plugin's card. */
export const modelsPanel = {
  checking: "Checking…",
  downloadNote: (bytes: number) =>
    `Needs a one-time download of ${formatBytes(bytes)}. It’s kept in this browser for later visits.`,
  download: (bytes: number) => `Download (${formatBytes(bytes)})`,
  downloading: (loaded: number, total: number) => `Downloading… ${formatBytes(loaded)} of ${formatBytes(total)}`,
  showLens: "Show on the page",
  rescore: "Rescore page",
  startFailed: "Couldn’t start this model.",
  model: (model: string) => `Model: ${model}`,
  knownPublisher: "Known publisher",
  fingerprint: "Fingerprint",
  checkForUpdate: "Check for update",
  remove: "Remove",
  confirmRemove: (name: string) =>
    `Remove ${name}? Its code, downloaded files, and pinned key are deleted. Pages it made stay.`,
  removed: (name: string) => `Removed ${name}.`,
  removeFailed: (name: string, reason: string) => `Couldn’t remove ${name}: ${reason}`,
  damaged: (reason: string) => `Damaged, so it doesn’t run: ${reason}`,
  installed: (name: string) => `Installed ${name}.`,
  updated: (name: string) => `Updated ${name}.`,
  install: "Install plugin…",
} as const;

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
  const { kind } = inspection;
  return {
    title:
      kind.is === "update"
        ? `Update ${card.name} from ${kind.previousVersion} to ${card.version}?`
        : `Install ${card.name} ${card.version}?`,
    rows,
    changes,
    confirm: kind.is === "update" ? "Update" : "Install",
  };
}

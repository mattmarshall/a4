/**
 * `a4 share <file> [<file>]` and `a4 open <link> [--out <folder>]`: share
 * links on the command line (README, "Share links"). `share` prints a link
 * to one page or a pair; `open` writes a link's pages to new files. A link
 * carries the page in its fragment, so neither makes a network request.
 * `open` never writes a postmark: a link can't make a letter sealed.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { copiedNotice, SEAL_MEANING, sealLine, specLabel } from "../components/share-copy.ts";
import { readSealedLetter } from "../lib/desk/index.ts";
import { sizeOfName } from "../lib/page/index.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";
import { sanitizePageName } from "../lib/persist/index.ts";
import { readLink, SHARE_ORIGIN, ShareError, type SharePageInput, sealOf, shareLink } from "../lib/share/index.ts";
import { folderArg } from "./letters.ts";
import { UsageError } from "./usage.ts";

export interface ShareArgs {
  readonly files: readonly string[];
}

export interface OpenArgs {
  readonly link: string;
  readonly out: string;
}

/** The most a shared file may hold: past this, no link could carry it. */
const MAX_SHARE_BYTES = 1024 * 1024;

async function page(path: string): Promise<SharePageInput> {
  const found = await stat(path).catch(() => null);
  if (!found) throw new UsageError(`“${path}” doesn’t exist.`);
  if (!found.isFile()) throw new UsageError(`“${path}” isn’t a file.`);
  if (found.size > MAX_SHARE_BYTES) {
    throw new ShareError("too-long", `“${path}” is larger than 1 MiB, too large for a link. Share the file instead.`);
  }
  const name = basename(path);
  // A postmark beside the file is its seal, read with the desk's limits; the link carries the bytes it covers.
  const sealed = await readSealedLetter(nodeFolderSource.open(dirname(resolve(path))), name);
  return {
    name,
    preset: "terminal",
    paper: sizeOfName(name),
    bytes: sealed?.bytes ?? new Uint8Array(await readFile(path)),
    ...(sealed ? { postmark: sealed.postmark } : {}),
  };
}

/** Print a link to one page or a pair. Exit status: 0 printed, 1 too long, 2 usage or a missing file. */
export async function runShare(args: ShareArgs): Promise<number> {
  try {
    const pages = await Promise.all(args.files.map(page));
    const link = await shareLink(pages, SHARE_ORIGIN);
    process.stdout.write(`${link}\n`);
    process.stderr.write(
      `${copiedNotice(
        pages.map((p) => p.name),
        link.length,
      ).replace(/^Copied/, "Made")}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ShareError) {
      process.stderr.write(`a4: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

/**
 * A shared page's name as a file name: a page name's rules (no folders or
 * control characters, no leading dots, at most 80 characters), ending in .md
 * (or the .mdc it had).
 */
export function safeFileName(name: string): string {
  const extension = /\.mdc$/i.test(name) ? ".mdc" : ".md";
  const stem = name
    .replace(/\.(md|mdc)$/i, "")
    .replace(/[/\\:*?"<>|\p{Cc}]/gu, "-")
    .replace(/^[.\s-]+/, "");
  return `${sanitizePageName(stem, "shared-page")}${extension}`;
}

/** The file names for `names`, made unique among themselves ("Brief.md", "Brief 2.md"). */
function fileNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const file = safeFileName(name);
    const dot = file.lastIndexOf(".");
    let candidate = file;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${file.slice(0, dot)} ${n}${file.slice(dot)}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Write a link's pages to new files. Every target is checked before any is
 * written, so a pair is never half-written. Exit status: 0 written, 1 a link
 * that can't be read, 2 a file that exists or a usage error.
 */
export async function runOpen(args: OpenArgs): Promise<number> {
  const folder = await folderArg(args.out);
  let pages: Awaited<ReturnType<typeof readLink>>;
  try {
    pages = await readLink(args.link);
  } catch (error) {
    if (error instanceof ShareError) {
      process.stderr.write(`a4: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const targets = fileNames(pages.map((p) => p.name)).map((file) => join(folder, file));
  for (const target of targets) {
    // Only a file that isn't there is free: any other failure to look stops before writing anything.
    const found = await stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (found) {
      // Not a usage error: the command was right, so the usage isn't printed. Still exit 2.
      throw new Error(`“${basename(target)}” already exists; a4 open never overwrites a file.`);
    }
  }
  for (const [i, p] of pages.entries()) {
    const target = targets[i] ?? "";
    await writeFile(target, p.bytes, { flag: "wx" });
    process.stdout.write(`Wrote ${basename(target)} (${specLabel(p.spec)})\n`);
    const seal = sealLine(await sealOf(p));
    if (seal) {
      process.stdout.write(
        `  ${seal}\n  ${SEAL_MEANING} The seal wasn’t written: seal the letter yourself to accept it.\n`,
      );
    }
  }
  return 0;
}

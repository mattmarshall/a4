#!/usr/bin/env node
/**
 * a4: A4's desk on the command line.
 *
 *   pnpm a4 lint [path ...] [--strict] [--exclude <glob>]... [--json]
 *   pnpm a4 letters [folder] [--latest | --json]
 *   pnpm a4 stacks [folder] [--json]
 *   pnpm a4 stack <name> [folder] [--letter]
 *   pnpm a4 xray [folder] [--budget <pages>] [--json]
 *   pnpm a4 mailroom [folder]
 *   pnpm a4 plugin keygen <file> | pack --card … | verify <file>
 *   node <checkout>/cli/a4.ts <command> ...
 *
 * This file parses the command line and dispatches; each command lives in its
 * own module (lint.ts, letters.ts, stacks.ts, xray.ts, mailroom.ts, plugin.ts).
 * `lint`, `letters`, `stacks`, and `stack` only read files. `mailroom` serves
 * the folder to an agent over MCP on standard input and output and writes only
 * new draft letters. `plugin` makes keys and packages and checks them, and
 * never runs a plugin's code. None makes a network request.
 *
 * Exit status: 0 when nothing fails, 1 when lint finds a failing file or
 * stack, the X-ray is over its budget, or a plugin package is refused, and 2
 * for a usage error or a path that can't be read.
 */

import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { DESK_PAGE, LETTERS_DIR, STACKS_DIR } from "../lib/desk/index.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";
import { folderArg, type LettersArgs, runLetters } from "./letters.ts";
import { type LintArgs, runLint } from "./lint.ts";
import { createMailroom } from "./mailroom.ts";
import { PACK_OPTIONS, type PluginArgs, pluginArgs, runPlugin } from "./plugin.ts";
import { runStack, runStacks, type StackArgs, type StacksArgs } from "./stacks.ts";
import { UsageError } from "./usage.ts";
import { runXray, type XrayArgs } from "./xray.ts";

const USAGE = `Usage: a4 lint [path ...] [--strict] [--exclude <glob>]... [--json]
       a4 letters [folder] [--latest | --json]
       a4 stacks [folder] [--json]
       a4 stack <name> [folder] [--letter]
       a4 xray [folder] [--budget <pages>] [--json]
       a4 mailroom [folder]
       a4 plugin keygen <file>
       a4 plugin pack --card <json> --code <js> --key <file> --publisher <name>
                      [--file <path>=<https url>]... [--out <file>]
       a4 plugin verify <file>

a4 lint checks agent context files, letters, and stack pages against one A4
page (${DESK_PAGE.cols} × ${DESK_PAGE.rows} cells), or a card or postcard on its own size (a
name ending .a5.md or .a6.md), and judges each stack's page budget. With no
path, it checks the current folder and below: AGENTS.md, CLAUDE.md, SKILL.md,
the others the folder view lists, the letters in ${LETTERS_DIR}/, and the
stacks in ${STACKS_DIR}/. A file named on the command line is checked whatever
its name.
  --strict          Fail Noisy and Busy pages too, not only pages over their rows
  --exclude <glob>  Skip files whose folder-relative path matches (repeatable)
  --json            Print an a4.v1.LintReport as JSON, and nothing else

a4 letters lists the letters in a folder's ${LETTERS_DIR}/ (the current folder
by default), oldest first, with their state, rows, signer, and reason.
  --latest          Print the newest accepted letter whose seal is intact, then a
                    note for each letter returned since. Prints nothing when no
                    letter can be delivered.
  --json            Print an a4.v1.LetterList as JSON (no letter text)

a4 stacks lists the stacks in a folder's ${STACKS_DIR}/, with each one's pages
used out of its budget, and its problems.
  --json            Print an a4.v1.StackList as JSON (no page text)

a4 stack prints one stack's pages, in order, each after a "--- <file> ---" line,
for a session-start hook.
  --letter          Put the newest accepted letter on top

a4 xray lists what Claude Code loads from files before its first turn in a
folder (the current folder by default): the CLAUDE.md files and their imports,
rules, auto memory, and skill and subagent descriptions. It lays each out as
pages and gives the total. It prints paths and numbers, never text.
  --budget <pages>  Exit 1 when the total is over this many pages
  --json            Print an a4.v1.ContextXray as JSON

a4 mailroom serves a folder (the current folder by default) to an agent over
the Model Context Protocol, on standard input and output: lint_page checks a
page, write_letter files a new draft letter in ${LETTERS_DIR}/, and
read_letter returns the latest accepted letter. No tool seals a letter.
Register it with your agent rather than running it by hand.

a4 plugin makes and checks third-party plugin packages (.a4plugin files). It
never runs a plugin's code.
  keygen <file>     Write a new Ed25519 signing key, readable only by you, and
                    print its public key and fingerprint. Never overwrites.
  pack              Sign a plugin: a model card in proto3 JSON (--card), one
                    script that imports nothing (--code), your key (--key), and
                    the name you publish as (--publisher). Each --file is a
                    model file and the HTTPS URL it will be served from.
                    Writes <id>-<version>.a4plugin unless --out names a file.
  verify <file>     Check a package as A4 does before installing it, and print
                    what it does, where it sends text, and who signed it.

  -h, --help        Show this help

Exit status: 0 when nothing fails, 1 when lint finds a failing file or stack,
the X-ray is over its budget, or a plugin package is refused, 2 for a usage
error or a path that doesn't exist.
`;

type Command =
  | { readonly kind: "help" }
  | ({ readonly kind: "lint" } & LintArgs)
  | ({ readonly kind: "letters" } & LettersArgs)
  | ({ readonly kind: "stacks" } & StacksArgs)
  | ({ readonly kind: "stack" } & StackArgs)
  | ({ readonly kind: "xray" } & XrayArgs)
  | { readonly kind: "mailroom"; readonly folder: string }
  | { readonly kind: "plugin"; readonly plugin: PluginArgs };

/** The options each command takes; any other is a usage error. */
const COMMAND_OPTIONS: Readonly<Record<Exclude<Command["kind"], "help">, readonly string[]>> = {
  lint: ["strict", "exclude", "json"],
  letters: ["latest", "json"],
  stacks: ["json"],
  stack: ["letter"],
  xray: ["budget", "json"],
  mailroom: [],
  plugin: PACK_OPTIONS,
};

function parse(argv: readonly string[]): Command {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      exclude: { type: "string", multiple: true, default: [] },
      latest: { type: "boolean", default: false },
      letter: { type: "boolean", default: false },
      budget: { type: "string" },
      card: { type: "string" },
      code: { type: "string" },
      key: { type: "string" },
      publisher: { type: "string" },
      file: { type: "string", multiple: true, default: [] },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return { kind: "help" };
  const [command, ...paths] = positionals;
  if (
    command !== "lint" &&
    command !== "letters" &&
    command !== "stacks" &&
    command !== "stack" &&
    command !== "xray" &&
    command !== "mailroom" &&
    command !== "plugin"
  ) {
    throw new UsageError(
      command
        ? `Unknown command “${command}”.`
        : "Name a command: lint, letters, stacks, stack, xray, mailroom, or plugin.",
    );
  }
  const given = Object.entries(values)
    .filter(
      ([name, value]) =>
        name !== "help" && (Array.isArray(value) ? value.length > 0 : value === true || typeof value === "string"),
    )
    .map(([name]) => name);
  const allowed = COMMAND_OPTIONS[command];
  const stray = given.find((name) => !allowed.includes(name));
  if (stray) {
    throw new UsageError(
      allowed.length === 0 ? `a4 ${command} takes no options.` : `--${stray} isn’t an option of a4 ${command}.`,
    );
  }
  switch (command) {
    case "lint":
      return {
        kind: "lint",
        paths: paths.length > 0 ? paths : ["."],
        strict: values.strict,
        json: values.json,
        exclude: values.exclude,
      };
    case "letters":
      if (paths.length > 1) throw new UsageError("a4 letters takes one folder.");
      if (values.latest && values.json) {
        throw new UsageError("--latest prints a letter’s text; --json lists letters. Choose one.");
      }
      return { kind: "letters", folder: paths[0] ?? ".", latest: values.latest, json: values.json };
    case "stacks":
      if (paths.length > 1) throw new UsageError("a4 stacks takes one folder.");
      return { kind: "stacks", folder: paths[0] ?? ".", json: values.json };
    case "stack": {
      const [name, folder, ...rest] = paths;
      if (!name) throw new UsageError("Name the stack: a4 stack <name> [folder].");
      if (rest.length > 0) throw new UsageError("a4 stack takes a stack name and one folder.");
      return { kind: "stack", name, folder: folder ?? ".", letter: values.letter };
    }
    case "xray": {
      if (paths.length > 1) throw new UsageError("a4 xray takes one folder.");
      const budget = values.budget === undefined ? null : Number(values.budget);
      if (budget !== null && !(Number.isFinite(budget) && budget > 0)) {
        throw new UsageError("--budget takes a positive number of pages.");
      }
      return { kind: "xray", folder: paths[0] ?? ".", budget, json: values.json };
    }
    case "mailroom":
      if (paths.length > 1) throw new UsageError("a4 mailroom takes one folder.");
      return { kind: "mailroom", folder: paths[0] ?? "." };
    case "plugin":
      return { kind: "plugin", plugin: pluginArgs(paths, values, given) };
  }
}

/**
 * Serve a folder over MCP's stdio transport: one message per line in, one
 * response per line out, handled in order so writes never interleave.
 * Standard output carries protocol messages only. Exits 0 when input closes.
 */
async function mailroom(folder: string): Promise<number> {
  const server = createMailroom({ fs: nodeFolderSource.open(await folderArg(folder)), now: () => Date.now() });
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    for (const response of await server.handle(line)) process.stdout.write(`${response}\n`);
  }
  return 0;
}

/** Report a failure: a usage error with the usage, anything else on its own. Exit status 2. */
function failed(error: unknown): number {
  if (error instanceof UsageError) process.stderr.write(`a4: ${error.message}\n\n${USAGE}`);
  else process.stderr.write(`a4: ${error instanceof Error ? error.message : String(error)}\n`);
  return 2;
}

async function run(args: Exclude<Command, { kind: "help" }>): Promise<number> {
  switch (args.kind) {
    case "lint":
      return runLint(args);
    case "letters":
      return runLetters(args);
    case "stacks":
      return runStacks(args);
    case "stack":
      return runStack(args);
    case "xray":
      return runXray(args);
    case "mailroom":
      return mailroom(args.folder);
    case "plugin":
      return runPlugin(args.plugin);
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Command;
  try {
    args = parse(argv);
  } catch (error) {
    // parseArgs reports unknown options and missing values as plain errors: those are usage errors too.
    return failed(
      error instanceof UsageError ? error : new UsageError(error instanceof Error ? error.message : String(error)),
    );
  }
  if (args.kind === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    return await run(args);
  } catch (error) {
    return failed(error);
  }
}

process.exitCode = await main(process.argv.slice(2));

# Proposal: add-mailroom-mcp

## Why

Letters exist (`add-letters`), but agents still write letter files by hand,
with no fit check. They can also only receive a letter through a shell hook
that prints text. Roadmap step 3 in `docs/platform.md` is the **mailroom**: a
local MCP server that any coding agent, harness, or review system can
register. Through it, an agent files a one-page letter after the desk's fit
check, and reads only letters a person has sealed.

The pieces it needs are built. The headless desk judges a page, `lib/desk/`
reads letters, states, and deliveries, and the `a4` command runs on Node. The
mailroom puts a protocol in front of them.

## What Changes

- **`a4 mailroom [folder]`.** A new command that serves the Model Context
  Protocol over stdio, rooted at one folder (the current directory by
  default). It makes no network request, and it reads and writes only inside
  that folder.
- **Three tools,** each with MCP annotations, so a client or an outside system
  can tell reads from writes without trusting the description:
  - **`lint_page`** (read-only) judges text on the 80 × 60 Terminal page. It
    returns rows used, rows over, the outcome, the verdict, and the findings,
    and writes nothing. It is the agent's fit loop.
  - **`write_letter`** (write, not destructive) files a new **draft** letter
    in `.agents/letters/`. A letter over 60 rows is not filed. The agent gets
    back the rows over and the findings, and rewrites. The tool never writes
    over an existing file and never writes a postmark.
  - **`read_letter`** (read-only) returns the newest accepted letter whose
    seal is intact, plus a note for each letter returned since. It is the
    same letter `a4 letters --latest` delivers. Given a digest, it returns
    that letter only if it is accepted and intact. It never returns the text
    of a draft, a returned letter, or a broken one.
- **No tool seals.** Agents write, people seal. Sealing stays in the app's
  seal dialog.
- **Session hooks for coding agents:**
  - *Start.* The existing `a4 letters --latest` session-start hook, now
    documented together with the mailroom.
  - *End.* The server's MCP `instructions` ask the agent to file a letter
    before it finishes or when its context runs low.
  - *On demand.* A `letter` MCP prompt (a slash command in clients that show
    prompts) asks the agent to write one from the Handoff form.
- **Structured results as protobuf.** A new `proto/a4/v1/mailroom.proto`
  defines `PageCheck`, `FiledLetter`, and `LetterDelivery`. Each tool returns
  readable text for the model, plus the message in proto3 JSON as MCP
  structured content for programs. Each record also carries the readable
  words as a `note`, because some clients show the model only the structured
  content.
- **Exclusive file creation.** The `FolderFs` contract gains an `exclusive`
  write that fails when the file already exists. Two agents filing in the
  same minute can't overwrite each other. Sealing uses the same write, so two
  processes can't both write a postmark.
- **Docs.** The README covers registering the mailroom (for example,
  `claude mcp add`) and the session hooks. `docs/platform.md` marks step 3
  built.

## Capabilities

### New Capabilities

- `mailroom`: the local MCP server. It covers:
  - the `a4 mailroom` command and its stdio transport;
  - protocol versions;
  - the three tools and their annotations;
  - the fit loop and filing rules (naming, topics, never overwriting,
    refusals);
  - delivery and lookup by digest;
  - the instructions and the `letter` prompt;
  - errors;
  - the promise that it reads and writes only its folder and makes no
    network request.

### Modified Capabilities

None. The `letters` rules (where letters live, states, digests, delivery) are
unchanged, and the mailroom builds on them. `folder-pages` "Creating files on
request" governs the app's folder view, not the separate `a4` program.
design.md records this boundary.

## Impact

- **New code:**
  - `cli/mailroom.ts`, the protocol: JSON-RPC message handling, tool
    definitions, the readable result text;
  - `cli/mailroom.test.ts`;
  - `proto/a4/v1/mailroom.proto` and its generated code;
  - `lib/desk/mailroom.ts`, the desk's rules for checking a page, filing a
    letter, and finding one by digest.
- **Changed code:**
  - `cli/a4.ts`, the `mailroom` command and usage;
  - `lib/desk/letters.ts`, `letterPathAt` with a topic, a digest for every
    readable letter, and `sealLetter` with an exclusive write;
  - `.dependency-cruiser.cjs`, so `cli/` may import `lib/desk/mailroom.ts`;
  - `lib/persist/folder/fs.ts`, `fs-node.ts`, and `fs-browser.ts`, the
    `exclusive` write and an `"exists"` error code;
  - the README and `docs/platform.md`.
- **Dependencies:** none. The server speaks MCP's stdio transport itself.
  design.md explains why it doesn't use the official SDK.
- **Privacy:**
  - Letter text goes only to the process that started the mailroom, over its
    standard output, and only for accepted letters.
  - Registering the mailroom with an agent is the person's choice to let that
    agent read accepted letters.
  - Nothing is sent over a network.

## Out of Scope

- **Sealing through a tool,** including one gated by an outside system's
  verdict. A tool call can't show that a person made it, so the seal stays a
  gesture in the app. An outside system that wants that has to make the case
  in a later change.
- **Showing a draft to an outside reviewer through the mailroom.** Drafts are
  reviewed in A4's folder view. A read tool for draft text needs its own
  design, so that a draft never reaches an agent as context.
- **Revising or deleting a letter.** An agent revises by checking with
  `lint_page` and filing once it fits. A new draft is the way to say
  something new.
- **The streamable HTTP transport,** remote access, authentication, and MCP
  `roots`. The mailroom is one local folder over stdio.
- **`outputSchema`** (JSON Schema for the structured results). The protobuf
  messages are the contract for now.
- **Resources and subscriptions** (letters as MCP resources, change
  notifications), and a mailroom tool that lists letters (`a4 letters --json`
  already does).
- **Hooks that force a letter,** such as blocking an agent from stopping. They
  fire every turn and depend on the harness. The end of a session is an
  instruction and a prompt, not an enforced gate.
- **Stacks, the fold ladder, and the context X-ray** (roadmap step 4).

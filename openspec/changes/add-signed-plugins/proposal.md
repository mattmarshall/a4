# Proposal

## Why

A4's model contract, `SheetModelService`, is open, but only the two plugins
bundled with the app can use it. Pens and overlays from anyone else can't
reach the page. The platform roadmap's first Later item is to open that door
without giving up what makes A4 safe to paste into:
- page text stays on the device unless the author consents to one call;
- model output never overwrites the author's page;
- the desk, not the plugin, decides fit.

A signature tells the author who made a plugin, and a sandbox makes the
privacy rules hold whoever made it.

## What Changes

- **Signed plugin packages.** A plugin ships as one file: a signed manifest
  (its model card, its publisher, the digest of its code, and the model files
  it may download), an Ed25519 signature, and a single-file worker bundle.
  The package is an `a4.v1` protobuf message.
- **Publisher tools.** `a4 plugin keygen`, `a4 plugin pack`, and
  `a4 plugin verify` make a signing key, package and sign a plugin, and check
  a package. They never run plugin code.
- **Install from a file or a URL.** The Models section gains Install plugin.
  The author picks a package file or pastes a URL. Before anything runs, A4
  verifies the signature and the code digest. It then shows:
  - the publisher's name and key fingerprint;
  - whether the publisher is on A4's list of known publishers;
  - what the plugin does, where it sends text, what it downloads, and which
    credentials it asks for.

  Nothing installs until the author confirms.
- **Trust: pinned keys, plus a known-publisher badge.** Installing pins the
  publisher's key to the plugin. An update installs only if the same key
  signed it and its version is newer. A4 ships a list of known publisher keys.
  A plugin signed by one of them shows a badge, and any other shows "Unknown
  publisher". The list ships empty, and a key is added only by a reviewed
  change to the repository.
- **A sandbox that enforces the card.** Installed plugin code runs only in a
  dedicated worker inside a sandboxed frame. Its content security policy is
  built from the signed card:
  - an overlay that keeps text on the device gets no network at all;
  - a pen or overlay that sends text off the device can reach only the one
    host its card names, and each call still needs the author's consent.

  The plugin has no storage and no access to the page or the app. It gets
  model files and credentials only from the host.
- **Pens and overlays in the app.**
  - An installed overlay's planes appear as model lenses, with a legend that
    names the plugin and its publisher.
  - An installed pen runs from the Models section like Fit to page: choose an
    instruction, confirm, and the host lays out each attempt. The result
    opens as a new page beside the source.
- **Updates and removal.** For a plugin installed from a URL, Check for update
  runs only when the author asks. Remove deletes the plugin's code, its files,
  and its pinned key.
- **Two example plugins** show the format and let the tests and docs run end
  to end: Word length, an on-device overlay, and Hard wrap, an on-device pen.
- **BREAKING (spec):** the `model-plugins` requirement "Bundled plugins only"
  is replaced. Plugin code still never comes from page content or imports,
  and comes from a URL only when the author installs from it.

### Out of scope

- Third-party plugins in the `a4` command, the headless desk, or the mailroom.
  Node has no content security policy, so running untrusted code there needs
  its own sandbox and its own change.
- A hosted plugin registry, plugin search, or ratings.
- Automatic update checks. A4 checks for an update only when the author asks.
- Key rotation, revocation lists, and transparency logs. To change keys, a
  publisher ships a new plugin, and the author removes the old one.
- Plugins that draw their own UI. An installed plugin gets the generic
  controls its card describes: planes, scores, findings, and instructions.
- Third-party plugins running outside the browser (a local service).
- Publishing an npm package for plugin authors. The protocol is documented,
  and the examples show how to build a plugin.
- Generate and Encode for installed plugins. Only Score (overlays) and
  Transform (pens) run in this change.

## Capabilities

### New Capabilities

- `plugin-packages`: The signed package format, its signature and digest
  checks, the protocol a plugin's code speaks, and the publisher commands that
  make keys and packages.
- `installed-plugins`: Installing a plugin from a file or a URL, trusting its
  publisher by pinned key and the known-publisher list, the sandbox it runs in,
  updates and removal, and how installed pens and overlays appear in the app.

### Modified Capabilities

- `model-plugins`: "Bundled plugins only" is replaced by a requirement that
  plugin code comes only from the app or from a signed package the author
  installed. Every other host rule (consent, fit, no overwrites, validated
  results) applies to installed plugins unchanged.

## Impact

- **Protos:** a new `proto/a4/v1/plugin.proto` with `PluginPackage`,
  `PluginManifest`, `Publisher`, and `ModelFile`. `ModelCard` is unchanged.
- **Models:** `lib/models/` gains package verification, an installed-plugin
  store, the sandbox transport, and the known-publisher list. The manifest
  stays the only place bundled plugins are registered. The host registers
  installed plugins beside them, and a third-party card can't take a bundled
  plugin's id.
- **Platform:** `lib/platform/` gains Ed25519 verification through Web Crypto,
  and a store for installed plugins in IndexedDB.
- **UI:** `components/ModelsPanel.tsx` lists installed plugins and adds
  Install, Check for update, and Remove. The lens bar and the model lens
  legend take planes from any plugin, not only Semantic repetition. The Fit
  to page job becomes a pen job any pen can run.
- **CLI:** `cli/plugin.ts` adds `a4 plugin keygen | pack | verify`.
- **Examples:** `examples/plugins/` with Word length and Hard wrap, and a
  script that builds them.
- **Docs:** README ("Model plugins", "Third-party plugins"), and
  `docs/platform.md` (the Later item becomes roadmap step 5).
- **Hosting:** no server change. The sandbox is built in the browser, and a
  URL install is a request from the browser to the publisher's host.

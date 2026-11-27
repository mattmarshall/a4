"use client";

/**
 * The shared view's banner: which pages are showing, that they're read-only
 * and not saved, a sealed letter's seal and what it means, and Save a copy
 * and Close.
 */

import { SEAL_MEANING, sealLine, sharedBanner, sharedSealFor, sharedShownOn, sharedViewCopy } from "../share-copy";
import type { SharedView } from "./useSharedView";

export function SharedBanner({ view, onSave, onClose }: { view: SharedView; onSave: () => void; onClose: () => void }) {
  const seals = view.pages.map((page, i) => ({ page, line: sealLine(view.seals[i] ?? { kind: "none" }) }));
  const sealed = seals.filter((s) => s.line !== null);
  return (
    <section className="shared-banner" aria-label={sharedViewCopy.label} data-print="hide">
      <p className="shared-banner-title">{sharedBanner(view.pages.map((p) => p.name))}</p>
      <p className="shared-banner-note">{sharedShownOn(view.pages.map((p) => p.spec))}</p>
      {sealed.map(({ page, line }) => (
        <p key={page.name} className="shared-banner-seal">
          {view.pages.length > 1 ? sharedSealFor(page.name) : ""}
          {line}
        </p>
      ))}
      {sealed.length > 0 ? <p className="shared-banner-note">{SEAL_MEANING}</p> : null}
      <div className="shared-banner-actions">
        <button type="button" className="btn btn-outline" onClick={onSave}>
          {sharedViewCopy.saveCopy}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {sharedViewCopy.close}
        </button>
      </div>
    </section>
  );
}

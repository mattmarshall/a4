"use client";

/** The top bar's Page, View, and Help menus. */

import Link from "next/link";
import { slugFromText } from "@/lib/archive";
import { PRESET_IDS, PRESETS, PX_PER_MM_ACTUAL } from "@/lib/page";
import { SAMPLE_PAIRS, TEMPLATES, WELCOME } from "@/lib/content";
import { SETTINGS, baseName } from "@/lib/persist";
import type { Notify } from "@/lib/workspace";
import type { StageSlot } from "./stage";
import { libraryNotices } from "../library-copy";
import { Menu, MenuItem } from "../Menu";
import { CLIPBOARD_BLOCKED } from "../share-copy";
import { useSetting } from "../useSetting";
import { saveFile } from "./download";
import type { Layout } from "./useLayout";

export function PageMenu({
  page,
  notify,
  onNewPage,
  onLoadPair,
  onClear,
  saveToFolder,
  onShare,
}: {
  /** The page the menu acts on (the active slot's). */
  page: StageSlot;
  notify: Notify;
  onNewPage: (desired: string, text: string) => void;
  /** Create a worked sample's two pages and open Compare. */
  onLoadPair: (id: string) => void;
  /** Erase the page's text; null for a page that can't be changed (a shared page, a sealed letter). */
  onClear: (() => void) | null;
  /** Offered while a folder is open and the page is in the library. */
  saveToFolder: { readonly folder: string; readonly onSelect: () => void } | null;
  /** Copy a share link to this page, or (in Compare) to A and B as a pair; null while there's nothing to share. */
  onShare: { readonly page: () => void; readonly pair: (() => void) | null } | null;
}) {
  async function copyText() {
    try {
      await navigator.clipboard.writeText(page.text);
      notify(libraryNotices.copiedText(page.label, page.text.length));
    } catch {
      notify(CLIPBOARD_BLOCKED, "warn");
    }
  }

  function downloadText() {
    // A shared page has no name of its own here: its label is the name it was shared under.
    const fileName =
      page.ref?.kind === "file" ? baseName(page.ref.path) : `${slugFromText(page.name ?? page.label ?? "")}.md`;
    saveFile(new Blob([page.text], { type: "text/markdown;charset=utf-8" }), fileName);
  }

  return (
    <Menu label="Page" title="New page, copy, download, print">
      {(close) => (
        <>
          <div className="menu-heading eyebrow">New</div>
          <MenuItem close={close} onSelect={() => onNewPage("Untitled", "")}>
            <strong>Blank page</strong>
            <span>Start from an empty sheet</span>
          </MenuItem>
          {TEMPLATES.map((t) => (
            <MenuItem key={t.id} close={close} onSelect={() => onNewPage(t.name, t.text)}>
              <strong>{t.name}</strong>
              <span>{t.blurb}</span>
            </MenuItem>
          ))}
          {SAMPLE_PAIRS.map((p) => (
            <MenuItem key={p.id} close={close} onSelect={() => onLoadPair(p.id)}>
              <strong>{p.name}</strong>
              <span>Worked sample: creates two pages and opens Compare</span>
            </MenuItem>
          ))}
          <MenuItem close={close} onSelect={() => onNewPage("Welcome", WELCOME)}>
            <strong>Welcome page</strong>
            <span>What A4 is, written as one page</span>
          </MenuItem>
          <div className="menu-sep" />
          <MenuItem close={close} onSelect={() => void copyText()}>
            <strong>Copy text</strong>
          </MenuItem>
          <MenuItem close={close} onSelect={downloadText}>
            <strong>Download .md</strong>
          </MenuItem>
          {onShare ? (
            <MenuItem close={close} onSelect={onShare.page}>
              <strong>Copy share link</strong>
              <span>A link that carries this page: anyone with it can read it</span>
            </MenuItem>
          ) : null}
          {onShare?.pair ? (
            <MenuItem close={close} onSelect={onShare.pair}>
              <strong>Copy share link for A and B</strong>
              <span>One link that opens both pages in Compare</span>
            </MenuItem>
          ) : null}
          <MenuItem close={close} onSelect={() => window.print()}>
            <strong>Print</strong>
          </MenuItem>
          {saveToFolder ? (
            <MenuItem close={close} onSelect={saveToFolder.onSelect}>
              <strong>Save to folder…</strong>
              <span>Write this page to a new file in {saveToFolder.folder}</span>
            </MenuItem>
          ) : null}
          {onClear ? (
            <>
              <div className="menu-sep" />
              <MenuItem close={close} onSelect={onClear}>
                <strong>Clear “{page.label ?? "page"}”</strong>
                <span>Erase this page’s text (autosaved)</span>
              </MenuItem>
            </>
          ) : null}
        </>
      )}
    </Menu>
  );
}

export function ViewMenu({ layout, gpuMissing }: { layout: Layout; gpuMissing: boolean }) {
  const [presetId, setPreset] = useSetting(SETTINGS.preset);
  const [grid, setGrid] = useSetting(SETTINGS.grid);
  const [render, setRender] = useSetting(SETTINGS.render);
  const effective = gpuMissing ? "flat" : render;
  const { zoom } = layout;
  return (
    <Menu label="View" title="Grid, rendering, zoom, pose, focus mode">
      {(close) => (
        <>
          <div className="menu-heading eyebrow">Grid</div>
          {PRESET_IDS.map((id) => (
            <MenuItem key={id} kind="radio" checked={presetId === id} close={close} onSelect={() => setPreset(id)}>
              <strong>
                {PRESETS[id].name} · {PRESETS[id].cols}×{PRESETS[id].rows}
              </strong>
              <span>{PRESETS[id].blurb}</span>
            </MenuItem>
          ))}
          <MenuItem kind="checkbox" checked={grid} close={close} onSelect={() => setGrid(!grid)}>
            <strong>Show cell grid</strong>
          </MenuItem>
          <div className="menu-sep" />
          <div className="menu-heading eyebrow">Rendering</div>
          <MenuItem
            kind="radio"
            checked={effective === "3d"}
            disabled={gpuMissing}
            title={gpuMissing ? "3D needs WebGPU" : undefined}
            close={close}
            onSelect={() => setRender("3d")}
          >
            <strong>3D</strong>
            <span>Paper you can fold, curl, and light (WebGPU)</span>
          </MenuItem>
          <MenuItem kind="radio" checked={effective === "flat"} close={close} onSelect={() => setRender("flat")}>
            <strong>Flat</strong>
          </MenuItem>
          <div className="menu-sep" />
          <div className="menu-heading eyebrow">Zoom</div>
          <MenuItem
            kind="radio"
            checked={zoom.kind === "fit"}
            close={close}
            onSelect={() => layout.setZoom({ kind: "fit" })}
          >
            <strong>Fit to the desk</strong>
          </MenuItem>
          <MenuItem
            kind="radio"
            checked={zoom.kind === "fixed" && Math.abs(zoom.mm - PX_PER_MM_ACTUAL) < 0.01}
            close={close}
            onSelect={() => layout.setZoom({ kind: "fixed", mm: PX_PER_MM_ACTUAL })}
          >
            <strong>Actual size (1:1)</strong>
            <span>1 mm on screen per mm of paper (96 dpi)</span>
          </MenuItem>
          <div className="menu-sep" />
          <MenuItem
            kind="checkbox"
            checked={layout.posePanel}
            disabled={effective !== "3d"}
            close={close}
            onSelect={() => layout.setPosePanel(!layout.posePanel)}
          >
            <strong>Pose and camera</strong>
            <span>Fold, curl, tilt, turn, and light</span>
          </MenuItem>
          <MenuItem kind="checkbox" checked={layout.focus} close={close} onSelect={() => layout.setFocus(true)}>
            <strong>Focus mode</strong>
            <span>Just the page and the desk. F to toggle, Esc to leave</span>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

export function HelpMenu() {
  return (
    <Menu label="Help">
      {() => (
        <>
          <Link href="/why" role="menuitem" className="menu-item">
            <strong>Why A4?</strong>
            <span>The problem, the method, and narrative data for agents</span>
          </Link>
          <Link href="/element" role="menuitem" className="menu-item">
            <strong>The &lt;a4-sheet&gt; element</strong>
            <span>Embed an editable page anywhere</span>
          </Link>
        </>
      )}
    </Menu>
  );
}

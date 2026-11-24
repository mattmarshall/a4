"use client";

import { useEffect } from "react";
import { A4_EVENTS, defineSheetElement, type A4Render } from "@/lib/render";
import styles from "./ElementDemo.module.css";

/**
 * Plain HTML, no React props: proves <a4-sheet> works from markup alone. In
 * print, the grid and figures flow as plain blocks and the captions and log hide.
 */
const MARKUP = `
<div class="${styles.grid}" data-print="flow">
  <figure data-print="flow">
    <a4-sheet id="demo-3d" render="auto" lens="syntax" tilt="40" turn="-20" curl="0.45"
      value='{"id": "INC-2291", "status": "mitigated", "owner": "platform"}'></a4-sheet>
    <figcaption data-print="hide"><code>&lt;a4-sheet lens="syntax" tilt="40" turn="-20" curl="0.45"&gt;</code></figcaption>
  </figure>
  <figure data-print="flow">
    <a4-sheet id="demo-flat" render="flat" zoom="2.2"
      value="Purpose: brief the agent that is about to act on the incident."></a4-sheet>
    <figcaption data-print="hide"><code>&lt;a4-sheet render="flat" zoom="2.2"&gt;</code></figcaption>
  </figure>
</div>
<p class="${styles.log}" id="demo-log" data-print="hide">Type on either sheet; input events appear here.</p>
`;

export function ElementDemo() {
  useEffect(() => {
    let cleanup = () => {};
    void defineSheetElement().then(() => {
      const log = document.getElementById("demo-log");
      const sheets = [...document.querySelectorAll("a4-sheet")];
      const offs = sheets.flatMap((sheet) => {
        const onInput = () => {
          if (log) log.textContent = `input from #${sheet.id}: ${sheet.value.length} characters`;
        };
        const onRender = (e: CustomEvent<A4Render>) => {
          sheet.dataset.render = e.detail;
        };
        sheet.addEventListener("input", onInput);
        sheet.addEventListener(A4_EVENTS.render, onRender);
        return [
          () => sheet.removeEventListener("input", onInput),
          () => sheet.removeEventListener(A4_EVENTS.render, onRender),
        ];
      });
      cleanup = () => {
        for (const off of offs) off();
      };
    });
    return () => cleanup();
  }, []);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: MARKUP is a constant in this file; no page or user text reaches it.
  return <div dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}

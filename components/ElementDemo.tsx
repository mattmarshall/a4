"use client";

import { useEffect } from "react";

/** Plain HTML, no React props: proves <a4-sheet> works from markup alone. */
const MARKUP = `
<div class="element-demo-grid">
  <figure>
    <a4-sheet id="demo-3d" render="auto" lens="syntax" tilt="40" turn="-20" curl="0.45"
      value='{"id": "INC-2291", "status": "mitigated", "owner": "platform"}'></a4-sheet>
    <figcaption><code>&lt;a4-sheet lens="syntax" tilt="40" turn="-20" curl="0.45"&gt;</code></figcaption>
  </figure>
  <figure>
    <a4-sheet id="demo-flat" render="flat" zoom="2.2"
      value="Purpose: brief the agent that is about to act on the incident."></a4-sheet>
    <figcaption><code>&lt;a4-sheet render="flat" zoom="2.2"&gt;</code></figcaption>
  </figure>
</div>
<p class="element-demo-log" id="demo-log">Type on either sheet; input events appear here.</p>
`;

export function ElementDemo() {
  useEffect(() => {
    let cleanup = () => {};
    void import("@/lib/element/a4-sheet").then(({ defineA4Sheet }) => {
      defineA4Sheet();
      const log = document.getElementById("demo-log");
      const onInput = (e: Event) => {
        const el = e.target as HTMLElement & { value: string };
        if (log) log.textContent = `input from #${el.id}: ${el.value.length} characters`;
      };
      const onRender = (e: Event) => {
        const el = e.target as HTMLElement;
        el.dataset.render = (e as CustomEvent<string>).detail;
      };
      document.addEventListener("input", onInput);
      document.addEventListener("a4-render", onRender);
      cleanup = () => {
        document.removeEventListener("input", onInput);
        document.removeEventListener("a4-render", onRender);
      };
    });
    return () => cleanup();
  }, []);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: MARKUP is a constant in this file; no page or user text reaches it.
  return <div dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}

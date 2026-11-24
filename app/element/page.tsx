import type { Metadata } from "next";
import Link from "next/link";
import { ElementDemo } from "@/components/ElementDemo";
import { A4_EVENTS, ATTRIBUTES } from "@/lib/render";

export const metadata: Metadata = {
  title: "<a4-sheet>: the A4 page as a web component",
  description: "Embed an editable A4 page of context in any page with the <a4-sheet> custom element.",
};

const USAGE = `<script type="module">
  // a4-sheet.js is the standalone build (pnpm build:element in the A4 repository).
  import { defineA4Sheet } from "./a4-sheet.js";
  defineA4Sheet();
</script>

<a4-sheet value="Purpose: …" lens="syntax" fold-bottom="0.4"></a4-sheet>`;

export default function ElementPage() {
  return (
    <main className="prose-page element-page">
      <Link className="back" href="/">
        ← Back to the sheet
      </Link>
      <header>
        <p className="kicker">Web component</p>
        <h1>
          <code>&lt;a4-sheet&gt;</code>
        </h1>
        <p className="lede">
          One editable A4 page of context in a single custom element. It renders in 3D with WebGPU, or flat, and keeps
          its text input, renderer, and styles in its own shadow root. No framework is required.
        </p>
      </header>
      <ElementDemo />
      <h2>Usage</h2>
      <pre className="figure">{USAGE}</pre>
      <table>
        <thead>
          <tr>
            <th>Attribute</th>
            <th>Values</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(ATTRIBUTES).map((attribute) => (
            <tr key={attribute.name}>
              <td>
                <code>{attribute.name}</code>
              </td>
              <td>{attribute.doc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Attributes set the initial and requested values. After the reader orbits the camera or the sheet folds, the{" "}
        <code>view</code> and <code>pose</code> properties read what is shown, and setting an attribute again, even to
        the same value, applies it.
      </p>
      <p>
        Events: <code>input</code> (composed), <code>{A4_EVENTS.focus}</code>, <code>{A4_EVENTS.render}</code>{" "}
        (&quot;3d&quot; or &quot;flat&quot;), <code>{A4_EVENTS.viewChange}</code>, <code>{A4_EVENTS.poseChange}</code>.
        Properties: <code>value</code>, <code>view</code> (<code>{"{ tilt, turn }"}</code>), <code>pose</code>,{" "}
        <code>render</code>. Methods: <code>focus()</code>, <code>fold()</code>, <code>setSelectionRange()</code>,{" "}
        <code>setPlane(name, {"{ text, values }"})</code>, <code>removePlane(name)</code>. Styling hooks:{" "}
        <code>--a4-font</code>, <code>--a4-desk</code>, <code>--a4-3d-height</code>, <code>--a4-radius</code>,{" "}
        <code>--a4-shadow</code>.
      </p>
    </main>
  );
}

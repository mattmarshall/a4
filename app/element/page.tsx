import type { Metadata } from "next";
import Link from "next/link";
import { ElementDemo } from "@/components/ElementDemo";

export const metadata: Metadata = {
  title: "<a4-sheet>: the A4 page as a web component",
  description: "Embed an editable A4 page of context in any page with the <a4-sheet> custom element.",
};

const USAGE = `<script type="module">
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
          <tr>
            <td>
              <code>value</code>
            </td>
            <td>
              Initial text (then use the <code>value</code> property)
            </td>
          </tr>
          <tr>
            <td>
              <code>render</code>
            </td>
            <td>
              <code>auto</code> (3D if WebGPU is available), <code>3d</code>, <code>flat</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>preset</code> · <code>lens</code>
            </td>
            <td>
              terminal, pica, elite, dense · ink, syntax, repetition, structure, tokens, or{" "}
              <code>model:&lt;name&gt;</code> for a plane
            </td>
          </tr>
          <tr>
            <td>
              <code>fold-bottom</code> · <code>fold-top</code> · <code>curl</code>
            </td>
            <td>0 to 1</td>
          </tr>
          <tr>
            <td>
              <code>tilt</code> · <code>turn</code> · <code>light</code>
            </td>
            <td>0–65° · −180–180° · azimuth in degrees</td>
          </tr>
          <tr>
            <td>
              <code>zoom</code> · <code>grid</code> · <code>label</code>
            </td>
            <td>CSS px per mm or fit · boolean · accessible name</td>
          </tr>
        </tbody>
      </table>
      <p>
        Events: <code>input</code> (composed), <code>a4-focus</code>, <code>a4-render</code> (&quot;3d&quot; or
        &quot;flat&quot;), <code>a4-viewchange</code>, <code>a4-posechange</code>. Methods: <code>focus()</code>,{" "}
        <code>fold()</code>, <code>setSelectionRange()</code>, <code>setPlane(name, {"{ text, values }"})</code>,{" "}
        <code>removePlane(name)</code>. Styling hooks: <code>--a4-font</code>, <code>--a4-desk</code>,{" "}
        <code>--a4-3d-height</code>, <code>--a4-radius</code>, <code>--a4-shadow</code>.
      </p>
    </main>
  );
}

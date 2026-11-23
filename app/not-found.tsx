import Link from "next/link";

export default function NotFound() {
  return (
    <main className="prose-page">
      <p className="kicker">404 · off the page</p>
      <h1>This page doesn’t fit.</h1>
      <p className="lede">There’s nothing at this address.</p>
      <Link className="cta" href="/">
        Back to the sheet
      </Link>
    </main>
  );
}

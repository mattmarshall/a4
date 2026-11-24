import Link from "next/link";
import styles from "./prose.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <p className={`${styles.kicker} eyebrow`}>404 · off the page</p>
      <h1>This page doesn’t fit.</h1>
      <p className={styles.lede}>There’s nothing at this address.</p>
      <Link className={styles.cta} href="/">
        Back to the sheet
      </Link>
    </main>
  );
}

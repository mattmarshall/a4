"use client";

/**
 * Which library the Pages panel shows: this browser's, or the one `a4 serve`
 * serves on this machine (README, "Served library"). With no served library
 * connected, it offers the Connect form, for when the link `a4 serve` prints
 * can't be clicked.
 */

import { useState } from "react";
import { DEFAULT_SERVE_PORT, type LibrarySource } from "@/lib/persist";
import type { WorkspaceSnapshot } from "@/lib/workspace";
import styles from "../LibraryPanel.module.css";
import { connectForm, servedSwitch } from "../served-copy";

/** Library switching. Connect returns an error message to show inline, or null. */
export interface LibraryActions {
  switchTo(kind: LibrarySource): void;
  connect(address: string, token: string): Promise<string | null>;
  disconnect(): void;
}

function ConnectForm({ onConnect, onCancel }: { onConnect: LibraryActions["connect"]; onCancel: () => void }) {
  const [address, setAddress] = useState(`127.0.0.1:${DEFAULT_SERVE_PORT}`);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={styles.connect}
      onSubmit={(e) => {
        e.preventDefault();
        void onConnect(address, token).then(setError);
      }}
    >
      <p className={styles.connectHint}>
        {connectForm.hint.before}
        <code>{connectForm.hint.command}</code>
        {connectForm.hint.after}
      </p>
      <input
        className={styles.input}
        aria-label={connectForm.addressLabel}
        value={address}
        onChange={(e) => {
          setAddress(e.target.value);
          setError(null);
        }}
      />
      <input
        className={styles.input}
        type="password"
        autoComplete="off"
        aria-label={connectForm.tokenLabel}
        placeholder={connectForm.tokenLabel}
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          setError(null);
        }}
      />
      {error ? <span className={styles.error}>{error}</span> : null}
      <div className={styles.connectActions}>
        <button type="submit" className="btn btn-outline">
          {connectForm.connect}
        </button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          {connectForm.cancel}
        </button>
      </div>
    </form>
  );
}

export function LibrarySwitch({ served, actions }: { served: WorkspaceSnapshot["served"]; actions: LibraryActions }) {
  const [connecting, setConnecting] = useState(false);
  if (served) {
    return (
      <section className={styles.libraries} aria-label="Library">
        <fieldset className="seg" aria-label={servedSwitch.label}>
          <button type="button" aria-pressed={!served.shown} onClick={() => actions.switchTo("browser")}>
            {servedSwitch.browser}
          </button>
          <button
            type="button"
            aria-pressed={served.shown}
            title={servedSwitch.servedTitle(served.address)}
            onClick={() => actions.switchTo("served")}
          >
            {servedSwitch.served}
          </button>
        </fieldset>
        <button type="button" className={styles.libraryLink} onClick={actions.disconnect}>
          {servedSwitch.disconnect}
        </button>
      </section>
    );
  }
  return (
    <section className={styles.libraries} aria-label="Library">
      {connecting ? (
        <ConnectForm
          onCancel={() => setConnecting(false)}
          onConnect={async (address, token) => {
            const error = await actions.connect(address, token);
            if (!error) setConnecting(false);
            return error;
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.libraryLink}
          onClick={() => setConnecting(true)}
          title={servedSwitch.connectTitle}
        >
          {servedSwitch.connect}
        </button>
      )}
    </section>
  );
}

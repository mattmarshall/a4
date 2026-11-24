/** A message channel to this origin's other tabs (BroadcastChannel in the browser). */
export interface Channel {
  post(message: Uint8Array): void;
  /** Call `listener` with each message another tab posts. Returns the unsubscribe. */
  subscribe(listener: (data: unknown) => void): () => void;
  close(): void;
}

/** The named BroadcastChannel, or null when the browser has none. */
export function browserChannel(name: string): Channel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(name);
  return {
    post: (message) => channel.postMessage(message),
    subscribe(listener) {
      const onMessage = (event: MessageEvent) => listener(event.data);
      channel.addEventListener("message", onMessage);
      return () => channel.removeEventListener("message", onMessage);
    },
    close: () => channel.close(),
  };
}

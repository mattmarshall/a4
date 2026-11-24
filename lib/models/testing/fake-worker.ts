/** Test helpers for code that talks to a dedicated Worker. */

/** A fake Worker over a MessageChannel, so tests can crash it. */
export class FakeWorker extends EventTarget {
  readonly channel = new MessageChannel();
  terminated = false;
  constructor() {
    super();
    this.channel.port1.addEventListener("message", (event) =>
      this.dispatchEvent(new MessageEvent("message", { data: event.data })),
    );
    this.channel.port1.start();
  }
  postMessage(message: unknown, transfer: Transferable[]) {
    this.channel.port1.postMessage(message, transfer);
  }
  terminate() {
    this.terminated = true;
    this.channel.port1.close();
    this.channel.port2.close();
  }
  crash(message = "boom") {
    const event = new Event("error") as Event & { message: string };
    Object.defineProperty(event, "message", { value: message });
    this.dispatchEvent(event);
  }
}

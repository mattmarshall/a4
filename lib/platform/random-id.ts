/** A fresh random id: 16 lowercase hex characters. */
export type RandomId = () => string;

export const randomId: RandomId = () => {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

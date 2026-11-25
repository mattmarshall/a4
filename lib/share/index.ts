/**
 * Share links: a page, or a pair, carried in a link's fragment (README,
 * "Share links"). The app and the `a4` command use this index.
 */

export {
  isShareFragment,
  readLink,
  SHARE_ORIGIN,
  ShareError,
  type SharePageInput,
  type SharedPageView,
  shareLink,
} from "./link.ts";
export { type SealOf, sealOf } from "./seal.ts";

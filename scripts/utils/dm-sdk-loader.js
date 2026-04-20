/**
 * Shared Dynamic Media delivery SDK bootstrap for EDS blocks.
 *
 * The vendored dm-sdk.mjs self-initialises on load: it calls scanDom(document)
 * and watchDom() automatically via its DOMContentLoaded / immediate boot.
 * This loader's job is:
 *   1. Ensure the module is imported exactly once (singleton promise).
 *   2. Optionally call scanDom(root) for a block subtree to catch images
 *      that were injected into the DOM after the SDK's initial document scan.
 *   3. Provide getDmImageUrlFromRow() for block-row URL resolution.
 */

const DM_SDK_IMPORT = new URL('../lib/dm-sdk.mjs', import.meta.url).href;

const LOADER_PROMISE_KEY = '__edsDmSdkLoader';

/**
 * Loads dm-sdk.mjs exactly once per page.
 * @returns {Promise<typeof import('../lib/dm-sdk.mjs')>}
 */
export function loadDmSdk() {
  if (!window[LOADER_PROMISE_KEY]) {
    window[LOADER_PROMISE_KEY] = import(DM_SDK_IMPORT);
  }
  return window[LOADER_PROMISE_KEY];
}

/**
 * Resolves asset URL from a block row (Universal Editor or plain markup).
 * Checks for <a href> first, then falls back to <img src>.
 * @param {ParentNode | null | undefined} row
 * @returns {string}
 */
export function getDmImageUrlFromRow(row) {
  if (!row) return '';
  const anchor = row.querySelector('a[href]');
  if (anchor?.href) return anchor.href;
  const img = row.querySelector('img[src]');
  if (img?.src) return img.src;
  return '';
}

/**
 * Loads the SDK and runs scanDom on `root` to activate any img[data-dm-src]
 * elements that may have been added after the SDK's initial document scan.
 * Falls back to setting img.src directly if the SDK fails to load.
 * @param {ParentNode | null | undefined} root
 * @param {(img: HTMLImageElement, src: string) => void} [onFallback]
 * @returns {Promise<void>}
 */
export async function initDmSdkInRoot(root, onFallback) {
  if (!root) return;
  try {
    const sdk = await loadDmSdk();
    if (typeof sdk.scanDom === 'function') {
      const hasUnmanaged = root.querySelector?.('img[data-dm-src]:not([data-dm-managed])');
      if (hasUnmanaged) {
        sdk.scanDom(root);
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('DM SDK not loaded. Falling back to static image URLs.', error);
    if (typeof onFallback === 'function') {
      root.querySelectorAll?.('img[data-dm-src]')?.forEach((el) => {
        const src = el.getAttribute('data-dm-src');
        if (src) onFallback(el, src);
      });
    }
  }
}

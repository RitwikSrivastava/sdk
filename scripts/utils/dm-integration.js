/**
 * Adobe Dynamic Media Integration for Edge Delivery Services — Approach B
 *
 * Drop this file into scripts/utils/ and vendor DmSdk.js into scripts/lib/.
 * Then make four surgical additions to your scripts.js (see comments below).
 *
 * ─── What to add to scripts.js ────────────────────────────────────────────
 *
 * 1. At the top (import):
 *    import { decorateExternalImages, activateDmSdk, promoteFirstBlockDmImage }
 *      from './utils/dm-integration.js';
 *
 * 2. Inside decorateMain(), before decorateBlocks():
 *    decorateExternalImages(main);
 *
 * 3. Inside loadEager(), after decorateMain() and before await loadSection():
 *    const sdkReady = activateDmSdk(main);
 *
 * 4. Inside loadEager(), after await loadSection():
 *    await sdkReady;
 *    promoteFirstBlockDmImage(main);
 *
 * ─── That's the entire integration ───────────────────────────────────────
 * No block JS changes required. No build step. No npm install.
 */

const DM_SDK_URL = 'https://delivery-p64653-e342218-cmstg.adobeaemcloud.com/adobe/assets/urn:aaid:aem:dmviewers-html5/as/DmSdk.js';
const SDK_PROMISE_KEY = '__edsDmSdk';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isDMOpenAPIUrl(src) {
  return /^https?:\/\/.*\/adobe\/assets\/urn:aaid:aem:/i.test(src);
}

function isScene7Url(src) {
  return /^https?:\/\/(.*\.)?scene7\.com\/is\/image\//i.test(src);
}

function parseDmSource(src) {
  try {
    const u = new URL(src, window.location.href);
    const s7 = u.pathname.match(/\/is\/image\/(.+)/i);
    if (s7) return { origin: u.origin, asset: s7[1], sourceUrl: u.href };
    if (isDMOpenAPIUrl(src)) return { origin: u.origin, asset: u.pathname.replace(/^\/+/, ''), sourceUrl: u.href };
  } catch { /* ignore malformed */ }
  return null;
}

function preconnectOrigin(origin) {
  if (!origin || document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = origin;
  link.crossOrigin = '';
  document.head.appendChild(link);
}

function buildDmImg(parsed, altText, isPriority) {
  const img = document.createElement('img');
  img.dataset.dmSrc = parsed.asset;
  img.dataset.dmOrigin = parsed.origin;
  img.dataset.dmSourceUrl = parsed.sourceUrl;
  if (isPriority) {
    img.setAttribute('data-dm-priority', '');
    img.setAttribute('data-dm-role', 'hero');
    img.setAttribute('fetchpriority', 'high');
  } else {
    img.setAttribute('loading', 'lazy');
  }
  if (altText) img.alt = altText;
  return img;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads DmSdk.js (UMD bundle) exactly once per page (singleton).
 * Uses script tag injection because DmSdk.js is a UMD/window bundle, not ESM.
 * Resolves with window.dmViewers.DmSdk (the named exports namespace).
 * @returns {Promise}
 */
export function loadDmSdk() {
  if (!window[SDK_PROMISE_KEY]) {
    window[SDK_PROMISE_KEY] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = DM_SDK_URL;
      script.onload = () => resolve(window.dmViewers?.DmSdk);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return window[SDK_PROMISE_KEY];
}

/**
 * Replaces DM delivery URL anchor links (<a href="https://...scene7...">)
 * and DM-sourced <picture> elements with <img data-dm-src> elements.
 * Must be called inside decorateMain(), before decorateBlocks().
 * The SDK (not this function) sets img.src via scanDom().
 * @param {Element} main
 */
export function decorateExternalImages(main) {
  let firstDm = true;

  main.querySelectorAll('a[href]').forEach((a) => {
    if (!isScene7Url(a.href) && !isDMOpenAPIUrl(a.href)) return;
    const parsed = parseDmSource(a.href);
    if (!parsed) return;
    preconnectOrigin(parsed.origin);
    const alt = a.innerText.trim();
    const img = buildDmImg(parsed, alt !== a.href ? alt : '', firstDm);
    firstDm = false;
    a.replaceWith(img);
  });

  main.querySelectorAll('picture').forEach((picture) => {
    let dmSrc = '';
    for (const source of picture.querySelectorAll('source')) {
      const candidate = (source.srcset || '').split(',')[0].trim().split(/\s+/)[0];
      if (candidate && (isScene7Url(candidate) || isDMOpenAPIUrl(candidate))) { dmSrc = candidate; break; }
    }
    if (!dmSrc) {
      const src = picture.querySelector('img')?.src || '';
      if (isScene7Url(src) || isDMOpenAPIUrl(src)) dmSrc = src;
    }
    if (!dmSrc) return;
    const parsed = parseDmSource(dmSrc);
    if (!parsed) return;
    preconnectOrigin(parsed.origin);
    const alt = picture.querySelector('img')?.alt || '';
    const img = buildDmImg(parsed, alt, firstDm);
    firstDm = false;
    picture.replaceWith(img);
  });
}

/**
 * Loads the SDK and calls scanDom(root) in a requestAnimationFrame so the
 * SDK measures accurate container widths. Call this in loadEager() in
 * parallel with (not before) loadSection() — do not await before loadSection.
 * @param {Element} root
 * @returns {Promise}
 */
export async function activateDmSdk(root) {
  if (!root) return;
  try {
    const sdk = await loadDmSdk();
    if (typeof sdk?.scanDom === 'function') {
      requestAnimationFrame(() => sdk.scanDom(root));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[DM SDK] Failed to load.', err);
  }
}

/**
 * After the eager section's block JS has run, any block-injected img[data-dm-src]
 * elements (e.g. from hero.js) need LCP priority promotion.
 * Call this in loadEager() after awaiting sdkReady.
 * @param {Element} root
 */
export function promoteFirstBlockDmImage(root) {
  if (root.querySelector('img[data-dm-priority]')) return;
  root.querySelectorAll('img[data-dm-src]').forEach((img) => {
    if (img.dataset.dmOrigin) preconnectOrigin(img.dataset.dmOrigin);
  });
  const first = root.querySelector('img[data-dm-src]:not([data-dm-priority]):not([data-dm-auto-priority])');
  if (!first) return;
  first.setAttribute('data-dm-priority', '');
  first.setAttribute('fetchpriority', 'high');
  first.removeAttribute('loading');
}

/**
 * Resolves a DM delivery URL from a block row.
 * Checks <a href> first (document authoring), then <img src> (UE authoring).
 * Optional — only needed in block JS that explicitly handles DM images.
 * @param {Element | null | undefined} row
 * @returns {string}
 */
export function getDmImageUrlFromRow(row) {
  if (!row) return '';
  const anchor = row.querySelector('a[href]');
  if (anchor?.href && (isScene7Url(anchor.href) || isDMOpenAPIUrl(anchor.href))) return anchor.href;
  const img = row.querySelector('img[src]');
  if (img?.src && (isScene7Url(img.src) || isDMOpenAPIUrl(img.src))) return img.src;
  // Handle img already decorated by decorateExternalImages (src not set yet, but sourceUrl is)
  const dmImg = row.querySelector('img[data-dm-source-url]');
  if (dmImg?.dataset.dmSourceUrl) return dmImg.dataset.dmSourceUrl;
  return '';
}

/**
 * Loads the SDK and runs scanDom on a block subtree.
 * Falls back to setting img.src directly if the SDK fails to load.
 * Optional — only needed in block JS that explicitly manages DM images.
 * @param {Element | null | undefined} root
 * @param {Function} [onFallback]
 */
export async function initDmSdkInRoot(root, onFallback) {
  if (!root) return;
  try {
    const sdk = await loadDmSdk();
    if (typeof sdk?.scanDom === 'function' && root.querySelector('img[data-dm-src]:not([data-dm-managed])')) {
      sdk.scanDom(root);
    }
  } catch {
    if (typeof onFallback === 'function') {
      root.querySelectorAll?.('img[data-dm-src]')?.forEach((el) => {
        const src = el.getAttribute('data-dm-src');
        if (src) onFallback(el, src);
      });
    }
  }
}

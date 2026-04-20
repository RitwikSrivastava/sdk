import {
  loadHeader,
  loadFooter,
  decorateButtons,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
} from './aem.js';
import { loadDmSdk } from './utils/dm-sdk-loader.js';

/**
 * Moves all the attributes from a given element to another given element.
 * @param {Element} from the element to copy attributes from
 * @param {Element} to the element to copy attributes to
 */
export function moveAttributes(from, to, attributes) {
  if (!attributes) {
    // eslint-disable-next-line no-param-reassign
    attributes = [...from.attributes].map(({ nodeName }) => nodeName);
  }
  attributes.forEach((attr) => {
    const value = from.getAttribute(attr);
    if (value) {
      to?.setAttribute(attr, value);
      from.removeAttribute(attr);
    }
  });
}

/**
 * Move instrumentation attributes from a given element to another given element.
 * @param {Element} from the element to copy attributes from
 * @param {Element} to the element to copy attributes to
 */
export function moveInstrumentation(from, to) {
  moveAttributes(
    from,
    to,
    [...from.attributes]
      .map(({ nodeName }) => nodeName)
      .filter((attr) => attr.startsWith('data-aue-') || attr.startsWith('data-richtext-')),
  );
}

// ---------------------------------------------------------------------------
// Dynamic Media URL helpers
// ---------------------------------------------------------------------------

function isDMOpenAPIUrl(src) {
  // No `g` flag — regex literals with `g` are stateful and advance lastIndex.
  return /^https?:\/\/.*\/adobe\/assets\/urn:aaid:aem:/i.test(src);
}

function isScene7Url(src) {
  return /^(https?:\/\/(.*\.)?scene7\.com\/is\/image\/(.*))/i.test(src);
}

/**
 * Returns true for any Dynamic Media delivery URL (Scene7 or OpenAPI).
 * @param {string} src
 * @returns {boolean}
 */
export function isDmUrl(src) {
  return isScene7Url(src) || isDMOpenAPIUrl(src);
}

/**
 * Parses a DM URL into { origin, asset, sourceUrl }.
 * Returns null for non-DM or malformed URLs.
 * @param {string} src
 * @returns {{ origin: string, asset: string, sourceUrl: string } | null}
 */
function parseDmSource(src) {
  try {
    const u = new URL(src, window.location.href);
    const scene7Match = u.pathname.match(/\/is\/image\/(.+)/i);
    if (scene7Match) {
      return { origin: u.origin, asset: scene7Match[1], sourceUrl: u.href };
    }
    if (isDMOpenAPIUrl(src)) {
      return { origin: u.origin, asset: u.pathname.replace(/^\/+/, ''), sourceUrl: u.href };
    }
  } catch {
    // ignore malformed URLs
  }
  return null;
}

/**
 * Inject a <link rel="preconnect"> to the given origin if one doesn't exist.
 * @param {string} origin
 */
function preconnectOrigin(origin) {
  if (!origin || document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = origin;
  link.crossOrigin = '';
  document.head.appendChild(link);
}

/**
 * Build a DM SDK-managed <img> from a parsed DM source.
 * Does NOT set img.src — the SDK sets it via scanDom().
 * The first DM image is marked as priority (likely the LCP hero).
 * @param {{ origin: string, asset: string, sourceUrl: string }} parsed
 * @param {string} altText
 * @param {boolean} isPriority
 * @returns {HTMLImageElement}
 */
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

/**
 * Converts Scene7 and DM OpenAPI image sources to SDK-managed img elements.
 * Handles <a href="…dm-url…"> links and <picture> elements.
 * Does NOT set img.src — the dm-sdk sets it via scanDom() / activateDmSdk().
 * @param {Element} main
 */
export function decorateExternalImages(main) {
  let firstDmImage = true;

  // 1. Anchor links pointing to a DM asset
  main.querySelectorAll('a[href]').forEach((a) => {
    if (!isScene7Url(a.href) && !isDMOpenAPIUrl(a.href)) return;
    const parsed = parseDmSource(a.href);
    if (!parsed) return;
    preconnectOrigin(parsed.origin);
    const altText = a.innerText.trim();
    const img = buildDmImg(parsed, altText !== a.href ? altText : '', firstDmImage);
    firstDmImage = false;
    a.replaceWith(img);
  });

  // 2. <picture> elements whose source/img points to a DM asset
  main.querySelectorAll('picture').forEach((picture) => {
    let dmSrc = '';
    for (const source of picture.querySelectorAll('source')) {
      const candidate = (source.srcset || '').split(',')[0].trim().split(/\s+/)[0];
      if (candidate && (isScene7Url(candidate) || isDMOpenAPIUrl(candidate))) {
        dmSrc = candidate;
        break;
      }
    }
    if (!dmSrc) {
      const innerImg = picture.querySelector('img');
      const src = innerImg?.src || '';
      if (isScene7Url(src) || isDMOpenAPIUrl(src)) dmSrc = src;
    }
    if (!dmSrc) return;
    const parsed = parseDmSource(dmSrc);
    if (!parsed) return;
    preconnectOrigin(parsed.origin);
    const innerAlt = picture.querySelector('img')?.alt || '';
    const img = buildDmImg(parsed, innerAlt, firstDmImage);
    firstDmImage = false;
    picture.replaceWith(img);
  });
}

/**
 * After eager-section blocks execute they may produce img[data-dm-src] elements
 * that were invisible to decorateExternalImages() (which runs before block JS).
 * This promotes the first untagged DM image to LCP priority and preconnects origins.
 * @param {Element} root
 */
function promoteFirstBlockDmImage(root) {
  const alreadyHasPriority = root.querySelector('img[data-dm-priority]');
  root.querySelectorAll('img[data-dm-src]').forEach((img) => {
    const { dmOrigin } = img.dataset;
    if (dmOrigin) preconnectOrigin(dmOrigin);
  });
  if (alreadyHasPriority) return;
  const first = root.querySelector('img[data-dm-src]:not([data-dm-priority]):not([data-dm-auto-priority])');
  if (!first) return;
  first.setAttribute('data-dm-priority', '');
  first.setAttribute('fetchpriority', 'high');
  first.removeAttribute('loading');
}

/**
 * Loads the dm-sdk and activates all img[data-dm-src] in root via scanDom().
 * Uses requestAnimationFrame so the SDK gets accurate container widths.
 * @param {Element} root
 */
async function activateDmSdk(root) {
  if (!root) return;
  try {
    const sdk = await loadDmSdk();
    if (typeof sdk.scanDom === 'function') {
      requestAnimationFrame(() => sdk.scanDom(root));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[DM SDK] Failed to load.', err);
  }
}

// ---------------------------------------------------------------------------

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks() {
  try {
    // TODO: add auto block, if needed
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
export function decorateMain(main) {
  decorateButtons(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  // Convert DM delivery URL links → img[data-dm-src] before blocks run
  decorateExternalImages(main);
  decorateSections(main);
  decorateBlocks(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');

    // Activate dm-sdk early (eager) so DM images get src before LCP fires.
    // activateDmSdk is intentionally not awaited — it runs in parallel with
    // loadSection so the SDK fetch doesn't delay first-section rendering.
    const sdkReady = activateDmSdk(main);

    await loadSection(main.querySelector('.section'), waitForFirstImage);

    // After the eager section's block JS has run, any block-injected
    // img[data-dm-src] elements need priority promotion and a scanDom pass.
    await sdkReady;
    promoteFirstBlockDmImage(main);
  }

  try {
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  loadHeader(doc.querySelector('header'));

  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

loadPage();

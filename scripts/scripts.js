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

/**
 * Moves all the attributes from a given elmenet to another given element.
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
 * Returns true for Dynamic Media delivery URLs (Scene7 or OpenAPI).
 * @param {string} url
 * @returns {boolean}
 */
export function isDmUrl(url) {
  return url.includes('scene7.com') || url.includes('adobeassets.com');
}

/**
 * Replaces <a href="DM-url"> links (and standalone <picture> elements whose
 * source points to a DM URL) with <img> elements that carry both a direct
 * src (for immediate rendering) and data-dm-* attributes (so the dm-sdk can
 * later apply adaptive sizing, LQIP and smart DPR on top).
 *
 * This is the Approach-B "link rewriting" step: the UE content model stores
 * the DAM delivery URL as a string/link; this function converts it to a
 * renderable image before any block JS runs.
 * @param {Element} main
 */
export function decorateExternalImages(main) {
  let firstDm = true;

  main.querySelectorAll('a[href]').forEach((a) => {
    if (!isDmUrl(a.href)) return;
    try {
      const url = new URL(a.href);
      const img = document.createElement('img');
      // Set src directly so the image renders immediately (UE + published page).
      img.src = a.href;
      img.dataset.dmOrigin = url.origin;
      img.dataset.dmSrc = url.pathname.replace(/^\/+/, '');
      img.alt = a.textContent.trim() === a.href ? '' : a.textContent.trim();
      if (firstDm) {
        img.setAttribute('fetchpriority', 'high');
        img.loading = 'eager';
        firstDm = false;
      } else {
        img.loading = 'lazy';
      }
      a.replaceWith(img);
    } catch {
      // skip malformed URLs
    }
  });
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
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  // hopefully forward compatible button decoration
  decorateButtons(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  // Convert DM delivery URL links → <img> before blocks decorate
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
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
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
 * Finds Dynamic Media images (Scene7 / OpenAPI) in the document, tags them
 * with data-dm-* attributes, then activates the dm-sdk observer so images
 * are served at the exact container width with smart DPR, LQIP, and lazy
 * loading — all contributing to a higher Lighthouse performance score.
 */
async function initDmSdk() {
  const dmImages = [...document.querySelectorAll('img')].filter((img) => {
    const src = img.src || '';
    return src.includes('scene7.com') || src.includes('adobeassets.com');
  });

  if (!dmImages.length) return;

  dmImages.forEach((img) => {
    if (img.dataset.dmSrc) return;
    try {
      const url = new URL(img.src);
      img.dataset.dmOrigin = url.origin;
      // Scene7:  /is/image/company/asset-name  → company/asset-name
      // OpenAPI: /adobe/assets/urn:aaid:...    → urn:aaid:...
      img.dataset.dmSrc = url.pathname
        .replace(/^\/is\/image\//, '')
        .replace(/^\/adobe\/assets\//, '');
    } catch {
      // skip malformed src
    }
  });

  const { scanDom } = await import('./dm-sdk.mjs');
  scanDom();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(async () => {
    await import('./delayed.js');
    initDmSdk();
  }, 3000);
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

loadPage();

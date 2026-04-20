import { isDmUrl } from '../../scripts/scripts.js';

export default async function decorate(block) {
  const rows = [...block.children];

  // Row 0: image | Row 1: alt text | Row 2+: rich text content
  const [imageRow, altRow, ...contentRows] = rows;
  const imageCell = imageRow?.children[0];

  if (imageCell) {
    // decorateExternalImages() has already converted <a href="dm-url"> → <img>
    // but in UE the server may still render it as <a>, so handle both.
    const anchor = imageCell.querySelector('a[href]');
    const img = imageCell.querySelector('img');
    const src = anchor?.href || img?.src;

    if (src && isDmUrl(src)) {
      let dmImg = img;

      if (anchor) {
        // Not yet converted — build the img manually (UE authoring path)
        const url = new URL(src);
        dmImg = document.createElement('img');
        dmImg.src = src;
        dmImg.dataset.dmOrigin = url.origin;
        dmImg.dataset.dmSrc = url.pathname.replace(/^\/+/, '');
        anchor.replaceWith(dmImg);
      }

      // Hero image is always the LCP candidate
      dmImg.setAttribute('fetchpriority', 'high');
      dmImg.loading = 'eager';
      dmImg.alt = altRow?.textContent.trim() || '';

      // Activate dm-sdk on this block immediately (don't wait for loadDelayed)
      try {
        const { scanDom } = await import('../../scripts/dm-sdk.mjs');
        scanDom(block);
      } catch {
        // dm-sdk unavailable — direct src already set, image still renders
      }
    }
  }

  // Hide the alt-text row (it is consumed above, not displayed separately)
  if (altRow) altRow.remove();

  // Wrap remaining content rows for styling
  contentRows.forEach((row) => row.classList.add('hero-content'));
}

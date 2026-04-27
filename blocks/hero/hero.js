import { getDmImageUrlFromRow, initDmSdkInRoot } from '../../scripts/utils/dm-integration.js';

export default async function decorate(block) {
  const rows = [...block.children];
  // Model row order: image, imageAlt, text
  const [imageRow, altRow, ...contentRows] = rows;

  const imageUrl = getDmImageUrlFromRow(imageRow);

  if (imageUrl) {
    const altText = altRow?.querySelector('div')?.textContent?.trim() || '';

    const img = document.createElement('img');
    img.dataset.dmSrc = imageUrl;
    img.dataset.dmSourceUrl = imageUrl;
    try {
      img.dataset.dmOrigin = new URL(imageUrl).origin;
    } catch {
      // ignore malformed URL
    }
    img.alt = altText;
    // Hero image is always the LCP candidate
    img.setAttribute('data-dm-priority', '');
    img.setAttribute('data-dm-role', 'hero');
    img.setAttribute('fetchpriority', 'high');
    img.loading = 'eager';

    // Clear the image row and insert the managed img
    imageRow.textContent = '';
    imageRow.append(img);

    await initDmSdkInRoot(block, (imgEl, src) => {
      imgEl.src = src;
    });
  }

  // Alt-text row is consumed above — not displayed separately
  if (altRow) altRow.remove();

  // Mark remaining content rows for styling
  contentRows.forEach((row) => row.classList.add('hero-content'));
}

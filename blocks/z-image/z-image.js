import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';
import { getDmImageUrlFromRow, initDmSdkInRoot } from '../../scripts/utils/dm-integration.js';

export default async function decorate(block) {
  await Promise.all([...block.children].map(async (row, i) => {
    const item = document.createElement('div');
    item.classList.add('z-image-item');
    item.classList.add(i % 2 === 0 ? 'z-image-item--normal' : 'z-image-item--reverse');
    moveInstrumentation(row, item);

    const [imageCell, textCell] = [...row.children];

    // Image cell
    const dmUrl = getDmImageUrlFromRow(imageCell);
    if (dmUrl) {
      const img = document.createElement('img');
      img.dataset.dmSrc = dmUrl;
      img.dataset.dmSourceUrl = dmUrl;
      try { img.dataset.dmOrigin = new URL(dmUrl).origin; } catch { /* ignore */ }
      img.setAttribute('data-dm-no-dimensions', '');
      img.alt = textCell?.querySelector('h2, h3')?.textContent?.trim() || '';
      img.loading = 'lazy';
      imageCell.textContent = '';
      imageCell.append(img);
    } else if (imageCell) {
      imageCell.querySelectorAll('picture > img').forEach((img) => {
        const optimizedPic = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
        moveInstrumentation(img, optimizedPic.querySelector('img'));
        img.closest('picture').replaceWith(optimizedPic);
      });
    }
    imageCell.className = 'z-image-media';

    if (textCell) textCell.className = 'z-image-text';

    item.append(imageCell);
    if (textCell) item.append(textCell);
    row.replaceWith(item);
  }));

  await initDmSdkInRoot(block, (imgEl, src) => { imgEl.src = src; });
}

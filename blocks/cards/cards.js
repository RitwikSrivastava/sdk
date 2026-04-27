import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';
import { getDmImageUrlFromRow, initDmSdkInRoot } from '../../scripts/utils/dm-integration.js';

export default async function decorate(block) {
  const ul = document.createElement('ul');

  await Promise.all([...block.children].map(async (row) => {
    const li = document.createElement('li');
    moveInstrumentation(row, li);

    const [imageCell, ...bodyCells] = [...row.children];

    // Check if the image cell contains a DM delivery URL
    const imageUrl = getDmImageUrlFromRow(imageCell);
    if (imageUrl) {
      const img = document.createElement('img');
      img.dataset.dmSrc = imageUrl;
      img.dataset.dmSourceUrl = imageUrl;
      try {
        img.dataset.dmOrigin = new URL(imageUrl).origin;
      } catch {
        // ignore
      }
      img.loading = 'lazy';
      imageCell.textContent = '';
      imageCell.append(img);
      imageCell.className = 'cards-card-image';
    } else if (imageCell) {
      // Non-DM: apply Franklin CDN optimisation for picture elements
      imageCell.querySelectorAll('picture > img').forEach((img) => {
        const optimizedPic = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
        moveInstrumentation(img, optimizedPic.querySelector('img'));
        img.closest('picture').replaceWith(optimizedPic);
      });
      const hasPicture = imageCell.querySelector('picture');
      const hasDmImg = imageCell.querySelector('img[data-dm-src]');
      imageCell.className = (hasPicture || hasDmImg) ? 'cards-card-image' : 'cards-card-body';
    }

    bodyCells.forEach((cell) => { cell.className = 'cards-card-body'; });

    li.append(imageCell, ...bodyCells);
    ul.append(li);
  }));

  block.replaceChildren(ul);

  // Activate dm-sdk for any DM images in this block
  await initDmSdkInRoot(block, (imgEl, src) => {
    imgEl.src = src;
  });
}

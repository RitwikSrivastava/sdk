import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation, isDmUrl } from '../../scripts/scripts.js';

export default function decorate(block) {
  /* change to ul, li */
  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    moveInstrumentation(row, li);
    while (row.firstElementChild) li.append(row.firstElementChild);
    [...li.children].forEach((div) => {
      // DM images arrive as plain <img> (via decorateExternalImages);
      // Franklin images arrive wrapped in <picture>.
      const hasPicture = div.children.length === 1 && div.querySelector('picture');
      const hasDmImg = div.children.length === 1 && div.querySelector('img');
      if (hasPicture || hasDmImg) div.className = 'cards-card-image';
      else div.className = 'cards-card-body';
    });
    ul.append(li);
  });
  // Only apply Franklin CDN optimisation for non-DM images
  ul.querySelectorAll('picture > img').forEach((img) => {
    if (isDmUrl(img.src)) return;
    const optimizedPic = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
    moveInstrumentation(img, optimizedPic.querySelector('img'));
    img.closest('picture').replaceWith(optimizedPic);
  });
  block.replaceChildren(ul);
}

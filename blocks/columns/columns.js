import { getDmImageUrlFromRow, initDmSdkInRoot } from '../../scripts/utils/dm-integration.js';

export default async function decorate(block) {
  const rows = [...block.children];
  const cols = [...rows[0].children];
  block.classList.add(`columns-${cols.length}-cols`);

  let hasDmImages = false;

  rows.forEach((row, rowIndex) => {
    // Odd/even class drives alternating image-left / image-right in CSS
    row.classList.add(rowIndex % 2 === 0 ? 'columns-row-odd' : 'columns-row-even');

    [...row.children].forEach((col) => {
      // Mark image-only columns: picture (Franklin CDN) or DM delivery URL
      const pic = col.querySelector('picture');
      const dmImg = col.querySelector('img[data-dm-src]');
      const isImageOnly = (pic || dmImg) && col.children.length === 1
        || col.children.length === 1 && col.firstElementChild?.tagName === 'P'
          && col.firstElementChild.children.length === 1
          && (col.firstElementChild.querySelector('picture')
            || col.firstElementChild.querySelector('img[data-dm-src]'));

      if (isImageOnly) {
        col.classList.add('columns-img-col');
        if (dmImg) hasDmImages = true;
      }
    });
  });

  if (hasDmImages) {
    await initDmSdkInRoot(block, (imgEl, src) => {
      imgEl.src = src;
    });
  }
}

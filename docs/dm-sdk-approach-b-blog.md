# Smart Images on Edge Delivery Services: Closing the Performance Gap with the Adobe Dynamic Media SDK

Adobe Edge Delivery Services (EDS) is built around one promise: fast. Pages are served directly from the CDN, with near-instant load times. But there is one category of content that can quietly undo all of that performance work — images.

Images are the single biggest Lighthouse risk on any content-heavy page. Get them right and your Lighthouse score reflects the speed EDS is designed to deliver. Get them wrong and even the fastest CDN cannot save your LCP score.

This post explains the standard way Dynamic Media images work in EDS, why that approach creates a performance gap, and how the Adobe Dynamic Media SDK closes that gap — automatically, and without changing anything for your authors.

---

## Part 1: Setting Up Dynamic Media Images in EDS (Approach B)

### How EDS and Dynamic Media Work Together

Adobe Dynamic Media (DM) is the enterprise image service built into AEM: it handles Smart Imaging, responsive cropping, format conversion (WebP, AVIF), and CDN-accelerated delivery. When an author selects an asset from the AEM DAM for use on an EDS page, DM provides a delivery URL — a direct link to the asset on the DM CDN.

In Universal Editor, authors click an image field and the Content Advisor picker opens. They browse the DAM, select an image, and confirm. Simple.

What happens behind the scenes is where things get interesting.

### Images Stored as Links

EDS uses a model called **Approach B** for Dynamic Media images. When an author picks an asset, the system does not embed the image directly into the page document. Instead, it stores the DM delivery URL as an `<a href>` hyperlink in the page content.

This is intentional. EDS supports multiple authoring surfaces — Universal Editor, Google Docs, Microsoft SharePoint — and a URL is the one format that travels cleanly across all of them. The EDS HTML pipeline faithfully publishes that link as-is:

```html
<!-- What the published page HTML contains -->
<a href="https://delivery-p166604-e1781313.adobeaemcloud.com/adobe/assets/urn:aaid:aem:82aedf99-85fb-4c89-820c-564f6df0ede5/as/AdobeStock_124360874.avif?assetname=AdobeStock_124360874.jpeg">
  https://delivery-p166604-e1781313.adobeaemcloud.com/adobe/assets/...
</a>
```

The page's JavaScript is responsible for converting this link into an actual `<img>` element at render time. This is the standard EDS block decoration pattern.

### Setting Up Approach B: Two Developer Steps

Before any Lighthouse optimisation, your development team needs to configure two things so that the Content Advisor picker is used for image fields and returns the correct DM delivery URL.

**Step A — Configure the Content Advisor picker in `component-models.json`**

Image fields in your component model are updated to use the Content Advisor component instead of the standard AEM assets browser. This tells Universal Editor to open the Content Advisor picker when an author clicks an image field:

```json
{
  "component": "custom-asset-namespace:custom-asset",
  "name": "image",
  "label": "Image",
  "configUrl": "https://main--mysite--myorg.aem.page/tools/caconfig.json",
  "valueType": "string"
}
```

**Step B — Create `tools/caconfig.json`**

The `configUrl` above points to a configuration file checked into your EDS project. This file tells the Content Advisor picker which AEM environment to connect to, which asset types to surface, and — critically — to return the DM delivery URL (not the author-tier URL) when an author selects an image:

```json
{
  "aemTier": "delivery",
  "alwaysUseDMDelivery": true,
  "filterSchema": [{ "value": "image/*" }]
}
```

Once these two steps are in place, authors can browse and select DM assets via the Content Advisor picker, and the correct delivery URL is stored in the page content automatically. This is the foundation — and it is all you need for Approach B to work.

---

## Part 2: Closing the Lighthouse Gap with the DM SDK

Approach B gets the right URL into your pages. But there is a performance gap between "stored as a URL" and "loaded as a fast, responsive, LCP-optimised image." This is where the Adobe Dynamic Media SDK comes in.

### Why Anchor Tags Hurt Lighthouse Performance

When a browser loads an EDS page, it does two things simultaneously: it parses the HTML to build the DOM, and it runs a **preload scanner** — a speculative pass over the raw HTML to find resources it should start downloading immediately, before the DOM is even fully built.

The preload scanner is smart, but it only looks for images in `<img src>`, `<picture>`, and `<link rel="preload">` tags. It does not look inside `<a href>`.

This creates three compounding problems for Approach B pages:

**1. The LCP image is invisible to the preload scanner.**
The hero image URL is sitting inside an `<a href>` tag. The browser does not know there is an image to fetch. It will not start downloading it until JavaScript runs and replaces the link with an `<img>` — by which point the browser has already committed to its LCP timing.

**2. No `fetchpriority` signal.**
Modern browsers use `fetchpriority="high"` on `<img>` elements (and `<link rel="preload">`) to tell the network stack: download this first, before anything else. An `<a href>` carries no such signal.

**3. No responsive sizing.**
The DM delivery URL stored as a link is a static URL — the same URL is served to a 375px mobile screen and a 2560px desktop monitor. DM's Smart Imaging can serve the right format automatically, but without width parameters in the URL, it cannot serve the right size.

The result: pages using Approach B without any additional handling commonly score **Poor on Lighthouse LCP**. The browser simply cannot know to prioritise an image hidden inside a hyperlink.

### What the DM SDK Does

The `@adobe/dm-sdk` is a small, self-contained JavaScript module (~13KB, no dependencies) designed to make DM images smart — responsive, lazy-loaded, DPR-aware, and LCP-optimised — with no manual `srcset` or `sizes` attributes required.

Its contract is simple: give it an `<img>` element with a `data-dm-src` attribute containing the DM asset path, and it does the rest.

```
Author picks image in UE
        ↓
DM delivery URL stored as <a href> in page HTML  [Approach B — already done]
        ↓
EDS publishes page — browser sees a text link
        ↓
scripts.js: decorateExternalImages()
    <a href="https://delivery-p..."> → <img data-dm-src="..." fetchpriority="high">
        ↓ (in parallel)
dm-sdk.mjs loads → scanDom() runs:
    • Injects <link rel="preload" fetchpriority="high"> for the hero image
    • Sets img.src to a width-aware, DPR-correct DM URL
    • Applies LQIP blurred placeholder for below-fold images
    • Attaches ResizeObserver for responsive upgrades on resize
        ↓
Browser downloads the right image at the right size → LCP fires early
```

For the hero image (the LCP candidate), the SDK immediately injects a `<link rel="preload" fetchpriority="high">` into the document `<head>` and sets the image URL — computed at the actual container width, multiplied by the device pixel ratio. The browser can start fetching the image before anything else on the page competes for bandwidth.

For images below the fold, the SDK applies a low-quality blurred placeholder (LQIP) immediately, and loads the full-resolution image only when it enters the viewport. This keeps initial page weight low without sacrificing visual quality.

### The SDK Integration: Two Files, Four Lines

This is a developer-done-once change. Once pushed to the repo, every page in the site gets smart DM images automatically — authors do not change their workflow at all.

**Step 1 — Add the SDK file**

Copy `dm-sdk.mjs` into `scripts/lib/`. This is a single file — no build step, no npm install. It is vendored directly into the project so there is no external CDN dependency.

**Step 2 — Add the integration utility**

Copy `scripts/utils/dm-integration.js` into your project. This single file (~70 lines) contains everything needed: the link-to-image rewriter, the SDK activator, the LCP promoter, and the per-block helpers. No other utility files are needed.

**Step 3 — Four surgical additions to `scripts.js`**

These are the only changes to your existing boilerplate code:

```js
// 1. At the top — add this import:
import { decorateExternalImages, activateDmSdk, promoteFirstBlockDmImage }
  from './utils/dm-integration.js';

// 2. Inside decorateMain(), before decorateBlocks():
decorateExternalImages(main);   // converts DM links → img[data-dm-src]

// 3. Inside loadEager(), after decorateMain():
const sdkReady = activateDmSdk(main);   // fetch SDK in parallel, don't block

// 4. Inside loadEager(), after await loadSection():
await sdkReady;
promoteFirstBlockDmImage(main);
```

That is the entire integration. The result in `scripts.js`:

```js
export function decorateMain(main) {
  decorateButtons(main);
  decorateExternalImages(main);  // DM links → img[data-dm-src] before blocks run
  decorateSections(main);
  decorateBlocks(main);
}

async function loadEager(doc) {
  // ...
  decorateMain(main);
  const sdkReady = activateDmSdk(main);   // SDK loads in parallel
  await loadSection(firstSection, waitForFirstImage);
  await sdkReady;
  promoteFirstBlockDmImage(main);
}
```

The `activateDmSdk` call is intentionally not awaited before `loadSection`. This means the SDK module fetch runs in parallel with your page's first section rendering — the SDK never delays content from appearing. It is ready by the time the section finishes loading.

---

## Before and After

| | Without SDK | With SDK |
|---|---|---|
| **What the browser sees** | `<a href="dm-url">` text link | `<img data-dm-src>` with `fetchpriority="high"` |
| **LCP image discoverable by preload scanner?** | No | Yes — `<link rel="preload">` injected by SDK |
| **Image size** | One fixed URL for all screens | Width × DPR computed per device |
| **Below-fold images** | Loaded with page | Lazy-loaded with LQIP placeholder |
| **Lighthouse LCP** | Commonly Poor | Significantly improved toward Good |
| **Author workflow change** | — | None |

Pages that previously scored Poor on Lighthouse LCP due to Approach B image handling see significant improvement with this integration. The LCP image goes from being invisible to the browser at parse time to having a `<link rel="preload" fetchpriority="high">` injected into the document `<head>` — the strongest possible signal to the browser's network stack.

---

## What This Means for Your Team

**For authors:** Nothing changes. The same Content Advisor picker, the same asset selection experience. The only difference is that images actually show up — and show up fast.

**For developers:** Approach B setup is two configuration files (component model field + `caconfig.json`). The SDK integration on top of that is two files to copy and four lines to add to `scripts.js`. Once done, all future pages benefit automatically.

**For the business:** DM's full delivery capabilities — Smart Imaging, Smart Crop, format optimisation — are now actually exercised on every page load, at the right size for every device. The investment in Dynamic Media delivers its full value.

---

## Conclusion

Approach B is the correct foundation for using Dynamic Media assets in EDS. It is compatible with every authoring surface, stores a single canonical URL, and lets DM handle format and quality optimisation. Every EDS project using Dynamic Media should be set up with the Content Advisor picker and a `caconfig.json` — this is where you start.

The Lighthouse gap — anchor tags invisible to the browser's preload scanner — is a rendering-layer concern, not an authoring or infrastructure concern. The Dynamic Media SDK closes that gap with a small, dependency-free module and four additions to `scripts.js`.

Together, Approach B and the DM SDK give you the right authoring model and the right delivery model. Your authors pick images the way they always have. Your users get them fast.

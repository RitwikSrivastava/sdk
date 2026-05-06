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

### How the DM SDK Solves Each Problem

**Problem 1 — LCP invisible to the preload scanner → SDK injects a `<link rel="preload">` as early as JS allows**

The raw HTML still contains `<a href>` — the browser's preload scanner (which runs before JavaScript) cannot see it as an image, and this does not change. What the SDK does is close that gap as much as possible within the JavaScript execution window: `decorateExternalImages()` converts the link to `<img data-dm-src>` before blocks run, and the SDK's `scanDom()` immediately injects a `<link rel="preload" fetchpriority="high">` into `<head>`. The browser's fetch scheduler picks this up and starts downloading the LCP image ahead of below-fold resources. This is not the same as a parser-discovered preload — the Lighthouse "Preload LCP image" audit will still flag this — but it is a significant improvement over no preload hint at all.

**Problem 2 — No `fetchpriority` signal → SDK promotes the LCP candidate automatically**

The SDK identifies the LCP candidate using a heuristic: if an image is large, positioned in the upper 90% of the viewport, and occupies at least 12% of the viewport area, it is treated as priority. The SDK sets `fetchpriority="high"` on the `<img>` element and includes it on the preload hint. If the integrator explicitly tags the hero with `data-dm-priority`, that signal is honoured directly. Either way, the network stack gets the strongest possible download priority signal.

**Problem 3 — No responsive sizing → SDK computes the exact URL per device**

Instead of using the static URL stored by the author, the SDK measures the image element's actual rendered container width using `ResizeObserver`, multiplies by the device pixel ratio (`window.devicePixelRatio`), snaps to a configurable width bucket (default: 10px steps, for CDN cache hit efficiency), and constructs a DM URL with the precise `width` and `dpr` parameters. A 375px mobile phone with a 3× screen requests a 1125px image; a 1440px laptop with a 2× display requests a 2880px image — all from the same authored URL, with no `srcset` or `sizes` required.

### What the DM SDK Does, End to End

The SDK is a small (~16KB), dependency-free JavaScript module. Its sole job is to find `<img data-dm-src="...">` elements on the page and make them smart — the right size, the right priority, loaded at the right time.

Here is the full pipeline, from author action to fast image:

```
Author selects image in Universal Editor
        ↓
Content Advisor picker stores DM delivery URL as <a href> in page content
        ↓
EDS publishes page — raw HTML contains <a href="https://delivery-p...">
        ↓
decorateExternalImages() runs (before block JS)
  → converts <a href> to <img data-dm-src>
  → adds fetchpriority="high" to the first (hero) image
        ↓
DmSdk.js loads from Adobe CDN (in parallel with first section rendering)
        ↓
scanDom() runs
  → injects <link rel="preload" fetchpriority="high"> for the hero image
  → computes width × DPR URL for each image via ResizeObserver
  → sets LQIP placeholder for below-fold images
        ↓
Browser fetches hero image with highest network priority
LCP fires early
```

**For the hero (LCP) image:** The SDK immediately injects a `<link rel="preload" fetchpriority="high">` into `<head>` and sets an adaptive image URL sized to the actual container width multiplied by the device pixel ratio. The URL is width-bucketed in 10px steps so similar devices share CDN cache hits.

**For below-fold images:** Instead of leaving the full-resolution image to load with the page, the SDK shows a blurred Low-Quality Image Placeholder (LQIP) immediately — a tiny, fast-loading version of the image that gives the page visual completeness. The full-resolution image loads only when the image scrolls into the viewport, via `IntersectionObserver`.

### The SDK Integration: One File, Four Lines

This is a developer-done-once change. Once pushed to the repo, every page in the site gets smart DM images automatically — authors do not change their workflow at all.

**Step 1 — Add the integration utility**

Copy `scripts/utils/dm-integration.js` into your EDS project. This single file contains everything needed: the link-to-image rewriter, the SDK loader, the LCP promoter, and the per-block helpers. The SDK itself (`DmSdk.js`) loads automatically from the Adobe CDN — no file to download, no npm install, no build step.

**Step 2 — Four additions to `scripts.js`**

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

## Live Reference

A working reference implementation is live at **[main--sdk--ritwiksrivastava.aem.live](https://main--sdk--ritwiksrivastava.aem.live/)**. This EDS site uses Approach B throughout — all image fields are configured with the Content Advisor picker and `caconfig.json` — and the DM SDK is wired into `scripts.js` exactly as described above. The hero image, cards, and zigzag image sections all receive SDK-managed, responsive DM delivery URLs with preload hints for the LCP candidate.

---

## Part 3: Before and After

| | Without SDK | With SDK |
|---|---|---|
| **What the browser sees** | `<a href="dm-url">` text link | `<img data-dm-src>` with `fetchpriority="high"` |
| **LCP image discoverable by preload scanner?** | No | No — but JS preload injected as early as possible |
| **`fetchpriority` signal on LCP image** | None | `fetchpriority="high"` set by SDK heuristic |
| **Image size** | One fixed URL for all screens | Width × DPR computed per device |
| **Below-fold images** | Loaded with page | Lazy-loaded with LQIP placeholder |
| **Lighthouse LCP** | Commonly Poor | Significantly improved toward Good |
| **Author workflow change** | — | None |

Pages that previously scored Poor on Lighthouse LCP due to Approach B image handling see significant improvement with this integration. The LCP image goes from being completely invisible to the browser at parse time to having a `<link rel="preload" fetchpriority="high">` injected into `<head>` as early as JavaScript allows — a substantial improvement, even if not equivalent to a natively parsed `<img>`.

---

## Part 4: What This Means for Your Team

**For authors:** Nothing changes. The same Content Advisor picker, the same asset selection experience. The only difference is that images actually show up — and show up fast.

**For developers:** The SDK integration on top of Approach B is one file to copy and four lines to add to `scripts.js`. Once done, all future pages benefit automatically.

**For the business:** DM's full delivery capabilities — Smart Imaging, Smart Crop, format optimisation — are now actually exercised on every page load, at the right size for every device. The investment in Dynamic Media delivers its full value.

---

## Conclusion

Approach B is the correct foundation for using Dynamic Media assets in EDS. It is compatible with every authoring surface, stores a single canonical URL, and lets DM handle format and quality optimisation. Every EDS project using Dynamic Media should be set up with the Content Advisor picker and a `caconfig.json` — this is where you start.

The Lighthouse gap — anchor tags invisible to the browser's preload scanner — is a rendering-layer concern, not an authoring or infrastructure concern. The Dynamic Media SDK closes that gap with a small, dependency-free module and four additions to `scripts.js`.

Together, Approach B and the DM SDK give you the right authoring model and the right delivery model. Your authors pick images the way they always have. Your users get them fast.

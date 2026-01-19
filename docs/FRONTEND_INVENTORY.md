# Front-end Inventory

## HTML entrypoints
- `public/scan.html`
- `public/scanvanvulpen.html`
- `public/research.html`
- `public/research-results.html`
- `public/report.html`

## Scripts
- `public/scripts/app/` (scan experience modules)
  - `state.js`, `sections.js`, `practice.js`, `intro.js`, `scan.js`, `results.js`, `bootstrap.js`
- `public/scripts/research.js` (research flow)
- `public/scripts/research-results.js` (research results)
- `public/scripts/viewport.js` (dynamic viewport helper)

## Styles
- `public/styles/tw.build.css` (compiled Tailwind)
- `public/styles/scan.css` (scan page overrides previously inline)
- `public/styles/tw.css` (source Tailwind)
- `public/styles/mobile.css`
- `public/styles/mobile-new.css`

## Data
- `public/data/cards.json` - Card definitions with image paths
- `public/data/card-insights.json` - English card explanations
- `public/data/card-insights-nl.json` - Dutch card explanations
- `public/data/insights.json` - Personalized insights

## Assets (organized structure)

All assets now live under `public/assets/`:

### Icons
- `public/assets/icons/` - SVG UI icons
  - Download.svg, ExternalLinkOutline.svg, heart.svg
  - LightBulbOutline.svg, LightningBoltOutline.svg
  - RefreshOutline.svg, x-mark.svg

### Logos
- `public/assets/logos/` - Brand assets
  - 23plusone.png
  - Br-ndLogo.webp
  - van-vulpen-logo-full.png
  - br-nd-logo.svg, br-nd-logo-element.svg

### Images
- `public/assets/images/` - Raster images and media
  - `cards/` - 24 happiness card images (numbered 1-24)
  - 23plusone_humanvaluesvisualized.gif

### Development/Test Assets
- `public/fakeCards/` - Practice/test card images (development only)

## Key references
- Scan pages load icons from `assets/icons/`
- Logos loaded from `assets/logos/` in all HTML pages
- Card data references images from `assets/images/cards/` (via cards.json)
- Practice cards may use fakeCards for development


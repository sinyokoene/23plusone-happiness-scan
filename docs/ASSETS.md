# Assets

## Organization

All assets are now organized under `public/assets/`:

### Directory Structure
- `public/assets/icons/` - SVG UI icons used in scan/research pages
- `public/assets/logos/` - Brand logos (SVG, PNG, WebP formats)
- `public/assets/images/` - Raster images and media files
  - `public/assets/images/cards/` - 24 happiness card images
  - Other GIFs and visuals

### Legacy Locations (deprecated)
- ~~`public/23plusoneCards/`~~ → moved to `public/assets/images/cards/`
- ~~Root-level images~~ → moved to `public/assets/logos/` or `public/assets/images/`

## Naming Conventions

- **Icons**: PascalCase with descriptive names (e.g. `LightBulbOutline.svg`)
- **Logos**: kebab-case for clarity (e.g. `br-nd-logo.svg`, `23plusone.png`)
- **Card images**: Number prefix with descriptive label (e.g. `1. idealism_better world.jpg`)

## HTML Usage

All HTML files use relative paths from the public directory root:

```html
<!-- Icons -->
<img src="assets/icons/heart.svg" alt="Yes">

<!-- Logos -->
<img src="assets/logos/Br-ndLogo.webp" alt="BR-ND">
<img src="assets/logos/23plusone.png" alt="23plusone">

<!-- Card images -->
<!-- These are loaded from data/cards.json which contains paths like: -->
"images": ["assets/images/cards/1. idealism_better world.jpg"]
```

## Data Files

Keep `/public/data/` as the canonical location for JSON payloads:
- `cards.json` - Card definitions with image paths
- `insights.json` - Personalized insights
- `card-insights.json` / `card-insights-nl.json` - Localized card explanations

## Adding New Assets

1. **Icons**: Add to `public/assets/icons/` with descriptive PascalCase names
2. **Logos**: Add to `public/assets/logos/` using kebab-case
3. **Images**: Add to `public/assets/images/` or appropriate subdirectory
4. Update references in HTML/JS files and `data/cards.json` if needed

## Notes

- The `fakeCards/` directory contains test images for development only
- All paths are relative to the public directory root (no leading slash needed in HTML)
- Assets are served statically by the web server from the `/public` directory


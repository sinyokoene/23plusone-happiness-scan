# Project Structure

This document outlines the organization of the 23plusone Happiness Scan codebase.

## Directory Structure

```
23plusone-scan/
├── db/                          # Database schemas and migrations
│   ├── schema.sql              # Main database schema
│   └── rls-policies.sql        # Row-level security policies
│
├── docs/                        # Project documentation
│   ├── ASSETS.md               # Asset organization guide
│   ├── COPYWRITER-TEXT-CONTENT.md
│   ├── CSS_ARCHITECTURE.md
│   ├── css-analysis-report.md
│   ├── FRONTEND_INVENTORY.md
│   ├── MOBILE-CSS-FIX.md
│   ├── NEXT-STEPS.md
│   ├── PROJECT_STRUCTURE.md    # This file
│   └── REPORT-IMPROVEMENTS.md
│
├── public/                      # Static frontend files
│   ├── assets/                 # Organized assets
│   │   ├── icons/              # SVG UI icons
│   │   │   ├── Download.svg
│   │   │   ├── ExternalLinkOutline.svg
│   │   │   ├── heart.svg
│   │   │   ├── LightBulbOutline.svg
│   │   │   ├── LightningBoltOutline.svg
│   │   │   ├── RefreshOutline.svg
│   │   │   └── x-mark.svg
│   │   ├── images/             # Raster images
│   │   │   ├── cards/          # 24 happiness card images
│   │   │   │   ├── 1. idealism_better world.jpg
│   │   │   │   ├── 2. loyal_moral.jpg
│   │   │   │   └── ... (24 total)
│   │   │   └── 23plusone_humanvaluesvisualized.gif
│   │   └── logos/              # Brand logos
│   │       ├── 23plusone.png
│   │       ├── Br-ndLogo.webp
│   │       ├── br-nd-logo-element.svg
│   │       ├── br-nd-logo.svg
│   │       └── van-vulpen-logo-full.png
│   │
│   ├── data/                   # JSON data files
│   │   ├── card-insights-nl.json
│   │   ├── card-insights.json
│   │   ├── cards.json          # Card definitions
│   │   └── insights.json
│   │
│   ├── fakeCards/              # Test/mock card images
│   │   └── ... (development only)
│   │
│   ├── scripts/                # JavaScript files
│   │   ├── app/                # Modular scan app scripts
│   │   │   ├── bootstrap.js
│   │   │   ├── intro.js
│   │   │   ├── practice.js
│   │   │   ├── results.js
│   │   │   ├── scan.js
│   │   │   ├── sections.js
│   │   │   └── state.js
│   │   ├── research-results.js
│   │   ├── research.js
│   │   └── viewport.js
│   │
│   ├── styles/                 # CSS files
│   │   ├── mobile-new.css
│   │   ├── mobile.css
│   │   ├── README.md
│   │   ├── scan.css
│   │   ├── tw.build.css        # Built Tailwind CSS (generated)
│   │   └── tw.css              # Tailwind source
│   │
│   ├── report.html             # PDF report page
│   ├── research-results.html   # Research dashboard
│   ├── research.html           # Research survey page
│   ├── scan.html               # Main scan (BR-ND branding)
│   └── scanvanvulpen.html      # Van Vulpen branded version
│
├── server/                      # Backend Node.js application
│   ├── db/
│   │   ├── migrations.js
│   │   └── pool.js
│   ├── lib/
│   │   ├── demographics.js
│   │   ├── mail.js
│   │   ├── prolific.js
│   │   └── scan-validation.js
│   ├── routes/
│   │   ├── analytics.js
│   │   ├── health.js
│   │   ├── prolific.js
│   │   ├── report.js
│   │   ├── research.js
│   │   └── scan.js
│   ├── .env.example
│   ├── check-supabase.js
│   ├── package.json
│   └── server.js
│
├── .gitignore
├── package.json                 # Root package.json (Tailwind build)
├── postcss.config.js
├── Procfile                     # Heroku/Railway config
├── railway.json
├── README.md                    # Main project readme
├── tailwind.config.js
└── vercel.json

```

## Key Directories

### `/public/assets/`
All static assets are organized by type:
- **icons/** - SVG UI icons used throughout the application
- **images/** - Raster images including card photos and GIFs
- **logos/** - Brand assets for BR-ND, 23plusone, and partner organizations

### `/public/data/`
JSON data files that power the application:
- `cards.json` - Card definitions with image paths
- `insights.json` - Personalized insights based on scores
- `card-insights.json` / `card-insights-nl.json` - Localized card explanations

### `/public/scripts/app/`
Modular JavaScript for the scan application:
- `state.js` - Global state management
- `sections.js` - Section navigation
- `practice.js` - Practice round logic
- `scan.js` - Main scan logic
- `results.js` - Results display
- `intro.js` - Introduction screen
- `bootstrap.js` - App initialization

### `/server/`
Backend Express.js application with:
- Database connection pooling
- API routes for scan submissions, benchmarks, and research
- Email notifications
- Validation and rate limiting

### `/docs/`
All project documentation consolidated in one location

## File Naming Conventions

- **HTML files**: lowercase with hyphens (e.g., `scan.html`, `research-results.html`)
- **JavaScript files**: camelCase (e.g., `bootstrap.js`, `practice.js`)
- **CSS files**: lowercase with hyphens (e.g., `scan.css`, `mobile-new.css`)
- **Assets**: kebab-case for SVGs, descriptive names for images
- **Documentation**: UPPERCASE with hyphens (e.g., `PROJECT_STRUCTURE.md`)

## Path References

All asset paths in HTML/JS use relative paths from the public directory root:

```html
<!-- Icons -->
<img src="assets/icons/heart.svg" alt="Yes">

<!-- Logos -->
<img src="assets/logos/23plusone.png" alt="23plusone">

<!-- Card images (loaded from JSON) -->
"images": ["assets/images/cards/1. idealism_better world.jpg"]

<!-- GIF -->
<img src="assets/images/23plusone_humanvaluesvisualized.gif">
```

## Build Process

1. **CSS Build**: Tailwind CSS is compiled via npm script
   ```bash
   npm run build:css        # Watch mode
   npm run build:css:once   # Single build
   ```

2. **Frontend Development**: Static files served from `/public`
   ```bash
   npm run dev              # Python HTTP server on port 5173
   ```

3. **Backend Development**: Node.js Express server
   ```bash
   cd server
   npm install
   node server.js           # Runs on port 3000
   ```

## Environment Variables

See `server/.env.example` for required environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `RESEARCH_DATABASE_URL` - Optional separate research database
- `NODE_ENV` - production/development
- Email configuration (SMTP)

## Git Workflow

Staged changes should be committed with descriptive messages:
- Feature additions: `feat: add mobile navigation`
- Bug fixes: `fix: correct timer calculation`
- Refactoring: `refactor: reorganize asset structure`
- Documentation: `docs: update project structure`

## Notes

- The `fakeCards/` directory contains test images and should not be deployed to production
- Generated files (`tw.build.css`) are git-ignored but required for deployment
- Server and frontend have separate `package.json` files with different dependencies

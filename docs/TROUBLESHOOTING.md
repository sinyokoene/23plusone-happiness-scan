# Troubleshooting Guide

Common issues and solutions for the 23plusone Happiness Scan platform.

## 📋 Table of Contents

- [Development Setup Issues](#development-setup-issues)
- [Asset Loading Issues](#asset-loading-issues)
- [Database Issues](#database-issues)
- [Frontend Issues](#frontend-issues)
- [Backend/API Issues](#backendapi-issues)
- [Mobile Browser Issues](#mobile-browser-issues)
- [Deployment Issues](#deployment-issues)

---

## Development Setup Issues

### Issue: `npm install` fails

**Symptoms:**
```
npm ERR! code ENOENT
npm ERR! syscall open
```

**Solutions:**

1. **Check Node.js version:**
   ```bash
   node --version  # Should be v14 or higher
   ```
   
2. **Clear npm cache:**
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Check for permission issues:**
   ```bash
   sudo chown -R $USER /usr/local/lib/node_modules
   ```

---

### Issue: Database connection fails

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solutions:**

1. **Verify PostgreSQL is running:**
   ```bash
   # macOS
   brew services list
   brew services start postgresql
   
   # Linux
   sudo systemctl status postgresql
   sudo systemctl start postgresql
   ```

2. **Check database exists:**
   ```bash
   psql -l  # List all databases
   createdb happiness_benchmark  # Create if missing
   ```

3. **Verify connection string in `.env`:**
   ```bash
   # server/.env
   DATABASE_URL=postgresql://username:password@localhost:5432/happiness_benchmark
   ```

4. **Test connection manually:**
   ```bash
   psql $DATABASE_URL
   ```

---

### Issue: CSS not updating

**Symptoms:**
- Changes to CSS files not reflecting in browser
- Old styles persist

**Solutions:**

1. **Rebuild Tailwind CSS:**
   ```bash
   npm run build:css:once
   ```

2. **Clear browser cache:**
   - Chrome: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
   - Safari: Cmd+Option+E, then Cmd+R
   - Firefox: Ctrl+Shift+R

3. **Check watch mode is running:**
   ```bash
   npm run build:css  # Should show "Watching for changes..."
   ```

4. **Verify output file is being generated:**
   ```bash
   ls -lh public/styles/tw.build.css
   ```

---

## Asset Loading Issues

### Issue: 404 errors for images/icons

**Symptoms:**
```
Failed to load resource: the server responded with a status of 404 (Not Found)
GET http://localhost:3000/23plusone.png 404
```

**Solutions:**

1. **Check asset paths after reorganization:**
   
   **Old paths (will fail):**
   ```html
   <img src="23plusone.png">
   <img src="Br-ndLogo.webp">
   <img src="23plusoneCards/1. idealism_better world.jpg">
   ```
   
   **New paths (correct):**
   ```html
   <img src="assets/logos/23plusone.png">
   <img src="assets/logos/Br-ndLogo.webp">
   <!-- Cards loaded via cards.json -->
   ```

2. **Verify files exist:**
   ```bash
   ls public/assets/logos/
   ls public/assets/icons/
   ls public/assets/images/cards/
   ```

3. **Check data/cards.json paths:**
   ```bash
   grep "23plusoneCards" public/data/cards.json
   # Should return nothing - all paths should be assets/images/cards/
   ```

4. **Clear browser cache and hard reload**

---

### Issue: Cards not loading in scan

**Symptoms:**
- Card container shows "Loading cards..."
- No card images appear
- Console error: "Cannot read property 'images' of undefined"

**Solutions:**

1. **Check cards.json is accessible:**
   ```bash
   curl http://localhost:5173/data/cards.json
   # Should return valid JSON
   ```

2. **Verify card image paths:**
   ```json
   // public/data/cards.json should have:
   {
     "id": 1,
     "images": ["assets/images/cards/1. idealism_better world.jpg"]
   }
   ```

3. **Check network tab in browser DevTools:**
   - Look for 404 errors on image requests
   - Verify paths match actual file locations

4. **Verify image files exist:**
   ```bash
   ls public/assets/images/cards/ | wc -l
   # Should show 24 files
   ```

---

## Database Issues

### Issue: Schema not applied

**Symptoms:**
```
ERROR: relation "responses" does not exist
```

**Solutions:**

1. **Run schema file:**
   ```bash
   psql $DATABASE_URL -f db/schema.sql
   ```

2. **Verify tables exist:**
   ```bash
   psql $DATABASE_URL -c "\dt"
   ```

3. **Check for errors in schema file:**
   ```bash
   psql $DATABASE_URL -f db/schema.sql -v ON_ERROR_STOP=1
   ```

---

### Issue: RLS policies blocking queries

**Symptoms:**
```
ERROR: new row violates row-level security policy
```

**Solutions:**

1. **Apply RLS policies:**
   ```bash
   psql $DATABASE_URL -f db/rls-policies.sql
   ```

2. **For development, disable RLS:**
   ```sql
   ALTER TABLE responses DISABLE ROW LEVEL SECURITY;
   ALTER TABLE research_entries DISABLE ROW LEVEL SECURITY;
   ```

---

## Frontend Issues

### Issue: JavaScript errors in console

**Symptoms:**
```
Uncaught TypeError: Cannot read property 'addEventListener' of null
```

**Solutions:**

1. **Check element exists before accessing:**
   ```javascript
   // Bad
   document.getElementById('startBtn').addEventListener('click', start);
   
   // Good
   const startBtn = document.getElementById('startBtn');
   if (startBtn) {
     startBtn.addEventListener('click', start);
   }
   ```

2. **Verify HTML element IDs match JavaScript:**
   ```bash
   grep -r "getElementById.*startBtn" public/scripts/
   grep -r 'id="startBtn"' public/*.html
   ```

3. **Check script loading order:**
   - Scripts with `defer` load after DOM
   - Move script tags to end of `<body>` if needed

---

### Issue: Timer not working on mobile

**Symptoms:**
- Timer stops or behaves incorrectly on mobile
- Viewport issues on iOS Safari

**Solutions:**

1. **Verify viewport.js is loaded:**
   ```html
   <script src="scripts/viewport.js"></script>
   ```

2. **Check console for viewport errors:**
   - Enable debug mode: Add `?debug=true` to URL

3. **Test on actual devices:**
   - iOS Safari behaves differently than Chrome DevTools mobile simulation
   - Use remote debugging for mobile

---

## Backend/API Issues

### Issue: API returns 500 errors

**Symptoms:**
```
POST /api/responses 500 Internal Server Error
```

**Solutions:**

1. **Check server logs:**
   ```bash
   # Look at terminal where server is running
   # Or check log files
   ```

2. **Verify database connection:**
   ```javascript
   // In server/db/pool.js
   console.log('Database URL:', process.env.DATABASE_URL);
   ```

3. **Test API endpoint manually:**
   ```bash
   curl -X POST http://localhost:3000/api/responses \
     -H "Content-Type: application/json" \
     -d '{"ihs": 75, "responses": []}'
   ```

4. **Check for missing environment variables:**
   ```bash
   cd server
   cat .env
   # Verify all required vars are set
   ```

---

### Issue: CORS errors

**Symptoms:**
```
Access to fetch at 'http://localhost:3000/api/responses' from origin 
'http://localhost:5173' has been blocked by CORS policy
```

**Solutions:**

1. **Verify CORS is enabled in server:**
   ```javascript
   // server/server.js
   app.use(cors({
     origin: true,
     credentials: true
   }));
   ```

2. **For development, allow all origins:**
   ```javascript
   app.use(cors({ origin: '*' }));
   ```

3. **Check preflight requests:**
   - Look for OPTIONS requests in Network tab
   - Verify 200 response from OPTIONS

---

## Mobile Browser Issues

### Issue: Layout breaks on iPhone

**Symptoms:**
- Footer overlaps content
- Sections don't fill screen
- Address bar causes layout shifts

**Solutions:**

1. **Verify viewport script is loaded early:**
   ```html
   <head>
     <script src="scripts/viewport.js"></script>
   </head>
   ```

2. **Check CSS uses dynamic viewport:**
   ```css
   /* Bad */
   .section {
     height: 100vh;
   }
   
   /* Good */
   .section {
     height: calc(var(--vh, 1vh) * 100);
   }
   ```

3. **Test with Safari iOS specifically:**
   - Chrome iOS uses different rendering engine
   - Use real iPhone or Xcode simulator

4. **Check footer height variable:**
   ```css
   :root {
     --footer-h: 64px;
   }
   
   .section {
     height: calc(var(--vh, 1vh) * 100 - var(--footer-h));
   }
   ```

---

### Issue: Touch interactions not working

**Symptoms:**
- Buttons don't respond to taps
- Swipe gestures not detected
- Delay on button clicks

**Solutions:**

1. **Disable touch-action delay:**
   ```css
   * {
     touch-action: manipulation;
   }
   ```

2. **Check touch target sizes:**
   ```css
   /* Minimum 44x44px for mobile */
   button {
     min-width: 44px;
     min-height: 44px;
   }
   ```

3. **Add touch event handlers:**
   ```javascript
   button.addEventListener('touchstart', handleTouch, { passive: true });
   ```

---

## Deployment Issues

### Issue: Assets not loading in production

**Symptoms:**
- Works locally but fails on Heroku/Vercel/Railway
- 404 errors for assets in production

**Solutions:**

1. **Check build output includes all assets:**
   ```bash
   # Verify public/ directory is deployed
   ls -R public/
   ```

2. **Use relative paths (no leading slash for static files):**
   ```html
   <!-- Good -->
   <img src="assets/logos/23plusone.png">
   
   <!-- May fail in production -->
   <img src="/assets/logos/23plusone.png">
   ```

3. **Verify static file serving in production:**
   ```javascript
   // server/server.js
   app.use(express.static('public'));
   ```

4. **Check deployment logs:**
   ```bash
   # Heroku
   heroku logs --tail
   
   # Railway
   railway logs
   
   # Vercel
   vercel logs
   ```

---

### Issue: Database migrations fail in production

**Symptoms:**
```
ERROR: relation "responses" does not exist
```

**Solutions:**

1. **Run migrations on production database:**
   ```bash
   # Heroku
   heroku pg:psql < db/schema.sql
   
   # Railway
   railway run psql $DATABASE_URL -f db/schema.sql
   ```

2. **Check production DATABASE_URL:**
   ```bash
   heroku config:get DATABASE_URL
   ```

3. **Verify database is provisioned:**
   ```bash
   heroku addons  # Check for PostgreSQL addon
   ```

---

## Still Having Issues?

### 1. Check Documentation
- `/docs/PROJECT_STRUCTURE.md` - File organization
- `/docs/ASSETS.md` - Asset paths and organization
- `README.md` - Setup and deployment

### 2. Enable Debug Mode
```javascript
// Add to relevant file
console.log('Debug:', {
  variableName,
  otherData
});
```

### 3. Check Browser DevTools
- **Console** - JavaScript errors
- **Network** - Failed requests, 404s
- **Elements** - Inspect DOM and styles
- **Application** - Local storage, session data

### 4. Test in Isolation
```javascript
// Create minimal test case
fetch('/api/responses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ihs: 75, responses: [] })
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

### 5. Ask for Help
- Open a GitHub issue with:
  - Description of problem
  - Steps to reproduce
  - Expected vs actual behavior
  - Screenshots/error messages
  - Environment (OS, browser, Node version)

---

## Quick Fixes Checklist

When something breaks, try these first:

```bash
# 1. Clear and reinstall
rm -rf node_modules package-lock.json
npm install

# 2. Rebuild CSS
npm run build:css:once

# 3. Restart servers
# Stop all processes (Ctrl+C)
# Then restart:
npm run dev          # Terminal 1
cd server && node server.js   # Terminal 2

# 4. Clear browser cache
# Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

# 5. Check git status
git status
git diff
# Make sure you didn't accidentally modify critical files

# 6. Check environment
cat server/.env
# Verify DATABASE_URL and other vars are correct
```

---

**Still stuck? Open an issue on GitHub with details!**

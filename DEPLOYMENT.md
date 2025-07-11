# Deployment Guide for 23plusone Happiness Scan

This document provides step-by-step deployment instructions for popular hosting platforms.

## 🚀 Heroku Deployment

### Prerequisites
- Heroku CLI installed
- Git repository initialized

### Steps

1. **Create Heroku app**
```bash
heroku create your-happiness-scan-app
```

2. **Add PostgreSQL database**
```bash
heroku addons:create heroku-postgresql:mini
```

3. **Set environment variables**
```bash
heroku config:set NODE_ENV=production
```

4. **Create Procfile**
```bash
echo "web: cd server && npm start" > Procfile
```

5. **Deploy**
```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

6. **Setup database**
```bash
heroku pg:psql < db/schema.sql
```

7. **Open your app**
```bash
heroku open
```

## ⚡ Vercel Deployment

### Prerequisites
- Vercel CLI installed or GitHub integration

### Steps

1. **Install Vercel CLI**
```bash
npm i -g vercel
```

2. **Create vercel.json**
```json
{
  "builds": [
    {
      "src": "server/server.js",
      "use": "@vercel/node"
    },
    {
      "src": "public/**",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/server/server.js"
    },
    {
      "src": "/(.*)",
      "dest": "/public/$1"
    }
  ],
  "env": {
    "DATABASE_URL": "@database-url"
  }
}
```

3. **Deploy**
```bash
vercel
```

4. **Add environment variables**
```bash
vercel env add DATABASE_URL
```

5. **Setup database** (use Vercel Postgres or external provider)

## 🌊 DigitalOcean App Platform

### Steps

1. **Create app.yaml**
```yaml
name: happiness-scan
services:
- name: web
  source_dir: /
  github:
    repo: your-username/23plusone-scan
    branch: main
  run_command: cd server && npm start
  environment_slug: node-js
  instance_count: 1
  instance_size_slug: basic-xxs
  envs:
  - key: NODE_ENV
    value: "production"
  - key: DATABASE_URL
    value: "your-database-url"

databases:
- engine: PG
  name: happiness-db
  num_nodes: 1
  size: db-s-1vcpu-1gb
```

2. **Deploy via GUI or CLI**
```bash
doctl apps create --spec app.yaml
```

## 🔧 Environment Variables

For all platforms, ensure these environment variables are set:

- `DATABASE_URL`: PostgreSQL connection string
- `NODE_ENV`: Set to "production" for production deployments
- `PORT`: Usually set automatically by the platform

## 📊 Database Setup

After deployment, run the schema on your production database:

```bash
# For Heroku
heroku pg:psql < db/schema.sql

# For other platforms with psql access
psql "$DATABASE_URL" -f db/schema.sql
```

## 🔍 Verification

After deployment, test these URLs:
- `https://your-app.com/` - Demo page
- `https://your-app.com/scan.html` - Direct scan
- `https://your-app.com/api/health` - API health check
- `https://your-app.com/api/stats` - Statistics endpoint

## 🔐 Security Checklist

- [ ] DATABASE_URL is set securely
- [ ] API endpoints return appropriate errors
- [ ] HTTPS is enabled
- [ ] CORS is properly configured
- [ ] Rate limiting is considered for production

## 📱 Embedding Test

Test the iframe embedding:

```html
<iframe src="https://your-app.com/scan.html"
        width="100%" height="650"
        style="border:0; border-radius:10px;"
        allowfullscreen></iframe>
```

## 🐛 Troubleshooting

### Common Issues

1. **Database connection fails**
   - Check DATABASE_URL format
   - Ensure database exists and schema is applied
   - Verify network access to database

2. **CORS errors**
   - Check CORS configuration in server.js
   - Ensure X-Frame-Options is not blocking iframes

3. **Build fails**
   - Check Node.js version compatibility
   - Verify all dependencies are in package.json
   - Check build logs for specific errors

4. **App doesn't load**
   - Check server logs
   - Verify PORT environment variable
   - Test API endpoints directly

# 23plusone Happiness Scan - Production Deployment

## 🚀 Quick Deploy to Railway (Recommended)

### 1. Create Railway Account
- Go to [railway.app](https://railway.app)
- Sign up with GitHub

### 2. Deploy Your App
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Add PostgreSQL database
railway add postgresql

# Deploy
railway up
```

### 3. Set Environment Variables
Railway will automatically set `DATABASE_URL`. No manual configuration needed!

### 4. Get Your Live URL
After deployment, Railway gives you a URL like:
`https://your-app-name.railway.app`

## 🌐 Alternative: Heroku Deploy

### 1. Create Heroku Account
- Go to [heroku.com](https://heroku.com)
- Install Heroku CLI

### 2. Deploy
```bash
# Login
heroku login

# Create app
heroku create your-happiness-scan

# Add PostgreSQL
heroku addons:create heroku-postgresql:mini

# Deploy
git add .
git commit -m "Deploy 23plusone Happiness Scan"
git push heroku main

# Setup database
heroku pg:psql < db/schema.sql
```

## 🎯 Alternative: Vercel + Supabase (Free)

### 1. Supabase Database
- Go to [supabase.com](https://supabase.com)
- Create new project
- Run the schema from `db/schema.sql` in SQL Editor
- Get connection string

### 2. Vercel Frontend
- Go to [vercel.com](https://vercel.com)
- Import your GitHub repo
- Add environment variable: `DATABASE_URL`
- Deploy

## 📊 Cost Comparison

| Platform | Cost/Month | Database | Setup Time |
|----------|------------|----------|------------|
| Railway | $5 | Included | 5 min |
| Heroku | $7 | $5 extra | 10 min |
| Vercel + Supabase | Free | Free tier | 15 min |
| DigitalOcean | $12 | $15 extra | 20 min |

## 🔧 Post-Deployment Checklist

After your app is live:

1. **Test the scan**: Visit your live URL
2. **Verify database**: Check `/api/stats` endpoint
3. **Test embedding**: Use the iframe code on a test site
4. **Monitor**: Set up uptime monitoring

## 🌟 Your Live URLs Will Be:

- **Demo**: `https://your-app.platform.app`
- **Scan**: `https://your-app.platform.app/scan.html`
- **API**: `https://your-app.platform.app/api/health`

## 📱 Embedding Your Live Scan

Once deployed, use this iframe code:

```html
<iframe src="https://your-app.platform.app/scan.html"
        width="100%" height="650"
        style="border:0; border-radius:10px;"
        allowfullscreen></iframe>
```

## 🎉 Ready for Production!

Your 23plusone Happiness Scan includes:
- ✅ Professional JPG card images
- ✅ Complete scoring algorithm
- ✅ Database persistence
- ✅ Social sharing
- ✅ Mobile responsive
- ✅ Embeddable iframe
- ✅ API endpoints for analytics

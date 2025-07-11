# 🚀 Deploy to Vercel + Supabase (FREE)

## Step 1: Setup Supabase Database (2 minutes)

### 1.1 Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Click "Start your project" 
3. Sign in with GitHub
4. Click "New Project"
5. Choose organization and name: `happiness-scan-db`
6. Generate a strong password
7. Choose region closest to you
8. Click "Create new project"

### 1.2 Setup Database Schema
1. Wait for project to finish setting up (~2 minutes)
2. Go to "SQL Editor" in left sidebar
3. Click "New Query"
4. Copy and paste this schema:

```sql
-- 23plusone Happiness Scan Database Schema
CREATE TABLE IF NOT EXISTS scan_responses (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    card_selections JSONB NOT NULL,
    ihs_score DECIMAL(5,2) NOT NULL,
    n1_score DECIMAL(5,2) NOT NULL,
    n2_score DECIMAL(5,2) NOT NULL,
    n3_score DECIMAL(5,2) NOT NULL,
    completion_time INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address INET
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_scan_responses_session_id ON scan_responses(session_id);
CREATE INDEX IF NOT EXISTS idx_scan_responses_created_at ON scan_responses(created_at);
CREATE INDEX IF NOT EXISTS idx_scan_responses_ihs_score ON scan_responses(ihs_score);

-- Insert some sample data for testing
INSERT INTO scan_responses (session_id, card_selections, ihs_score, n1_score, n2_score, n3_score, completion_time)
VALUES 
('sample-session-1', '{"selected": [1, 5, 12, 18], "domains": ["personal", "social"]}', 75.5, 80.0, 70.0, 75.0, 96),
('sample-session-2', '{"selected": [3, 7, 14, 20], "domains": ["work", "health"]}', 82.3, 85.0, 78.0, 82.0, 104);
```

5. Click "Run" to execute the schema
6. You should see "Success. No rows returned."

### 1.3 Get Database Connection String
1. Go to "Settings" → "Database"
2. Scroll down to "Connection string"
3. Copy the "URI" connection string (starts with `postgresql://`)
4. **IMPORTANT**: Replace `[YOUR-PASSWORD]` with your actual database password

## Step 2: Deploy to Vercel (3 minutes)

### 2.1 Prepare for Deployment
First, let's make sure your code is ready:

```bash
# Navigate to your project
cd /Users/sinyo/br-nd/23plusone-scan

# Initialize git if not already done
git init
git add .
git commit -m "Initial commit - 23plusone Happiness Scan"

# Push to GitHub (create repo first on github.com)
git remote add origin https://github.com/YOUR-USERNAME/23plusone-scan.git
git branch -M main
git push -u origin main
```

### 2.2 Deploy to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "Continue with GitHub"
3. Click "Import" next to your `23plusone-scan` repository
4. **Configure Project**:
   - Framework Preset: "Other"
   - Root Directory: `./` (leave as default)
   - Build and Output Settings: leave as default

### 2.3 Add Environment Variables
1. In Vercel deployment settings, scroll to "Environment Variables"
2. Add this variable:
   - **Name**: `DATABASE_URL`
   - **Value**: Your Supabase connection string from Step 1.3
3. Click "Deploy"

## Step 3: Test Your Live App (1 minute)

After deployment completes:

1. **Visit your app**: `https://your-project-name.vercel.app`
2. **Test the scan**: `https://your-project-name.vercel.app/scan.html`
3. **Check API**: `https://your-project-name.vercel.app/api/health`
4. **View stats**: `https://your-project-name.vercel.app/api/stats`

## 🎉 Your Live Happiness Scan Platform

### URLs:
- **Main Demo**: `https://your-project-name.vercel.app`
- **Scan Interface**: `https://your-project-name.vercel.app/scan.html`
- **API Health**: `https://your-project-name.vercel.app/api/health`
- **Statistics**: `https://your-project-name.vercel.app/api/stats`

### Embed Code:
```html
<iframe src="https://your-project-name.vercel.app/scan.html"
        width="100%" height="650"
        style="border:0; border-radius:10px;"
        allowfullscreen></iframe>
```

## 🔧 Managing Your Live App

### Supabase Dashboard:
- **View responses**: Go to Supabase → Table Editor → scan_responses
- **Monitor usage**: Dashboard shows database activity
- **Backup data**: Built-in daily backups

### Vercel Dashboard:
- **Monitor traffic**: Analytics tab
- **View logs**: Functions tab
- **Update code**: Push to GitHub auto-deploys

## 💰 Cost Breakdown (FREE!)

- **Supabase**: Free tier (500MB database, 50MB file storage)
- **Vercel**: Free tier (100GB bandwidth, unlimited static sites)
- **Total**: $0/month ✨

## 🚀 Next Steps

1. **Custom Domain** (optional): Add your own domain in Vercel settings
2. **Analytics**: Monitor usage in both Supabase and Vercel dashboards
3. **Updates**: Push code changes to GitHub for automatic deployment

Your 23plusone Happiness Scan is now live and ready for the world! 🌟

# Quick setup guide for fixing the database connection

## IMMEDIATE FIX NEEDED:

Your Vercel deployment is missing the DATABASE_URL environment variable.

### GET YOUR SUPABASE CONNECTION STRING:

1. Go to: https://supabase.com/dashboard/project/owlgsgtlupuwdfvafv
2. Click: Settings → Database
3. Find: "Connection string" section
4. Copy: The URI format (NOT the Node.js format)
5. It looks like:
   postgresql://postgres.owlgsgtlupuwdfvafv:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.co:6543/postgres

### ADD TO VERCEL:

1. Go to: https://vercel.com/sinyokoenes-projects/23plusone-happiness-scan
2. Click: Settings → Environment Variables  
3. Add:
   - Key: DATABASE_URL
   - Value: [Paste your complete connection string]
4. Click: Save
5. Go to: Deployments → Click "..." → Redeploy

### TEST AFTER FIX:

- https://23plusone-happiness-scan.vercel.app/api/stats should show real data
- New scans will create unique session IDs in Supabase
- You'll see row count increase in your database

## CURRENT STATUS:
✅ Frontend working (scan shows results)
✅ API server running (health check OK)
🔄 Testing transaction pooler connection...
❌ Scan responses not saving (500 error)

The fix is using the transaction pooler connection string!

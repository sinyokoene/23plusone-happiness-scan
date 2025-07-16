#!/bin/bash

# Script to apply RLS policies to Supabase database
# Make sure you have your Supabase connection details

echo "🔒 Applying Row Level Security (RLS) policies to scan_responses table..."

# You can run this in three ways:

echo "
📋 OPTION 1: Supabase Dashboard SQL Editor
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of db/rls-policies.sql
4. Click 'Run' to execute

📋 OPTION 2: psql command line
1. Install psql if you haven't already:
   brew install postgresql (on macOS)
2. Connect to your Supabase database:
   psql 'postgresql://postgres:[password]@[host]:5432/postgres'
3. Run the SQL file:
   \\i db/rls-policies.sql

📋 OPTION 3: Using this script with environment variables
1. Set your Supabase database URL:
   export SUPABASE_DATABASE_URL='postgresql://postgres:[password]@[host]:5432/postgres'
2. Run this script:
   ./apply-rls-policies.sh
"

# If SUPABASE_DATABASE_URL is set, try to apply automatically
if [ ! -z "$SUPABASE_DATABASE_URL" ]; then
    echo "🔗 Found SUPABASE_DATABASE_URL, attempting to apply policies..."
    
    if command -v psql &> /dev/null; then
        echo "✅ Applying RLS policies..."
        psql "$SUPABASE_DATABASE_URL" -f db/rls-policies.sql
        
        if [ $? -eq 0 ]; then
            echo "✅ RLS policies applied successfully!"
            echo "🛡️ Your scan_responses table is now secured with:"
            echo "   - Public INSERT access (for scan submissions)"
            echo "   - Public READ access (for benchmarking)"
            echo "   - No UPDATE/DELETE access (data integrity)"
            echo "   - Analytics view for safe data access"
        else
            echo "❌ Error applying policies. Check your connection and try manually."
        fi
    else
        echo "❌ psql not found. Please install PostgreSQL client or use manual options above."
    fi
else
    echo "ℹ️ Set SUPABASE_DATABASE_URL environment variable to auto-apply, or use manual options above."
fi

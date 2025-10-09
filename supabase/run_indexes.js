// Script to apply performance indexes to Supabase database
// Run with: node supabase/run_indexes.js

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://rnpfeblxapdafrbmomix.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJucGZlYmx4YXBkYWZyYm1vbWl4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTMyMzA2MiwiZXhwIjoyMDc0ODk5MDYyfQ.wH6GIB3bAOHSN8SRNy99CmXTKqZl7p_lrMVBf3nxBkc';

async function runIndexes() {
  console.log('🚀 Applying performance indexes to Supabase...\n');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Read SQL file
  const sqlPath = path.join(__dirname, 'add_performance_indexes.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split by semicolons and filter out comments/empty lines
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  console.log(`Found ${statements.length} SQL statements to execute\n`);

  // Execute each statement
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];

    // Extract index/table name for logging
    const match = statement.match(/(?:INDEX|ANALYZE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
    const name = match ? match[1] : `Statement ${i + 1}`;

    try {
      console.log(`⏳ Executing: ${name}...`);

      const { error } = await supabase.rpc('exec_sql', { sql_query: statement + ';' });

      if (error) {
        // Try alternative approach using direct query
        const { error: altError } = await supabase.from('_').select('*').limit(0);

        console.warn(`⚠️  Note: RPC method not available, indexes should be created via Supabase Dashboard SQL Editor`);
        console.log(`   Copy add_performance_indexes.sql to Dashboard and run manually\n`);
        break;
      } else {
        console.log(`✅ ${name} created successfully\n`);
      }
    } catch (err) {
      console.error(`❌ Error executing ${name}:`, err.message);
    }
  }

  console.log('\n📝 Manual steps:');
  console.log('1. Go to: https://supabase.com/dashboard/project/rnpfeblxapdafrbmomix/sql');
  console.log('2. Copy contents of supabase/add_performance_indexes.sql');
  console.log('3. Paste into SQL Editor and click "Run"');
  console.log('\n✨ This will create all indexes and update table statistics');
}

runIndexes().catch(console.error);

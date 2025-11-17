# Support Feedback Analysis - Deployment Steps

## Prerequisites
- Supabase CLI installed
- Project linked to Supabase

## 1. Run Database Migration

```bash
# Apply the schema migration
supabase db push
```

## 2. Set Environment Variables

```bash
# Zendesk credentials
supabase secrets set ZENDESK_SUBDOMAIN=your-subdomain
supabase secrets set ZENDESK_EMAIL=your-email@company.com
supabase secrets set ZENDESK_TOKEN=your-api-token

# Instabug credentials
supabase secrets set INSTABUG_TOKEN=your-instabug-token

# Claude API (if not already set)
supabase secrets set ANTHROPIC_API_KEY=your-anthropic-key

# Optional: Analysis lookback period (default: 7 days)
supabase secrets set ANALYSIS_LOOKBACK_DAYS=7
```

## 3. Deploy Edge Functions

```bash
# Deploy all three functions
supabase functions deploy sync-support-conversations
supabase functions deploy analyze-support-feedback
supabase functions deploy trigger-support-analysis
```

## 4. Test Functions

```bash
# Test the full pipeline
curl -X POST \
  https://your-project-ref.supabase.co/functions/v1/trigger-support-analysis \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

## 5. (Optional) Set Up Weekly Cron Job

Run this SQL in Supabase SQL Editor:

```sql
-- Schedule weekly analysis every Monday at 9 AM UTC
SELECT cron.schedule(
  'weekly-support-analysis',
  '0 9 * * 1',
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/trigger-support-analysis',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

## 6. View Results

Query the analysis results:

```sql
SELECT * FROM support_analysis_results
ORDER BY created_at DESC
LIMIT 1;
```

## Troubleshooting

- Check edge function logs: `supabase functions logs [function-name] --follow`
- Check sync status: `SELECT * FROM support_sync_status;`
- Check conversations: `SELECT COUNT(*), source FROM raw_support_conversations GROUP BY source;`

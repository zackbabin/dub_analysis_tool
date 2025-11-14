#!/bin/bash

# Backfill script for sync-mixpanel-users-v2
# Backfills 90 days of data in 7-day chunks

# Configuration
SUPABASE_URL="https://rnpfeblxapdafrbmomix.supabase.co"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJucGZlYmx4YXBkYWZyYm1vbWl4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTMyMzA2MiwiZXhwIjoyMDc0ODk5MDYyfQ.YNVjIXxAtlTjHyK9LAGqgJ7H_4USPB0exYVxlwvoYb4"
FUNCTION_URL="${SUPABASE_URL}/functions/v1/sync-mixpanel-users-v2"

# Calculate dates (90 days back from yesterday)
END_DATE=$(date -v-1d +%Y-%m-%d)  # Yesterday
START_DATE=$(date -v-90d +%Y-%m-%d)  # 90 days ago

echo "Starting backfill from $START_DATE to $END_DATE (90 days)"
echo "Processing in 7-day chunks..."
echo ""

# Convert dates to seconds for iteration
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  current_date=$(date -j -f "%Y-%m-%d" "$START_DATE" +%s)
  end_date_sec=$(date -j -f "%Y-%m-%d" "$END_DATE" +%s)
else
  # Linux
  current_date=$(date -d "$START_DATE" +%s)
  end_date_sec=$(date -d "$END_DATE" +%s)
fi

chunk_num=1
total_chunks=13  # 90 days / 7 days per chunk = ~13 chunks

while [ $current_date -le $end_date_sec ]; do
  # Calculate chunk dates
  if [[ "$OSTYPE" == "darwin"* ]]; then
    from_date=$(date -r $current_date +%Y-%m-%d)
    chunk_end=$(($current_date + (6 * 86400)))  # Add 6 days (7 days total)

    # Don't go past end date
    if [ $chunk_end -gt $end_date_sec ]; then
      chunk_end=$end_date_sec
    fi

    to_date=$(date -r $chunk_end +%Y-%m-%d)
  else
    from_date=$(date -d "@$current_date" +%Y-%m-%d)
    chunk_end=$(($current_date + (6 * 86400)))

    if [ $chunk_end -gt $end_date_sec ]; then
      chunk_end=$end_date_sec
    fi

    to_date=$(date -d "@$chunk_end" +%Y-%m-%d)
  fi

  echo "[$chunk_num/$total_chunks] Processing: $from_date to $to_date"

  # Make request
  response=$(curl -s -X POST "$FUNCTION_URL" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"from_date\": \"$from_date\", \"to_date\": \"$to_date\"}")

  # Check for errors in response
  if echo "$response" | grep -q "error"; then
    echo "  ❌ Error: $response"
    echo "  Stopping backfill due to error"
    exit 1
  else
    echo "  ✅ Success"
    # Extract key metrics if available
    if echo "$response" | grep -q "totalEvents"; then
      events=$(echo "$response" | grep -o '"totalEvents":[0-9]*' | cut -d: -f2)
      users=$(echo "$response" | grep -o '"totalRecordsInserted":[0-9]*' | cut -d: -f2)
      echo "     Events: $events, Users: $users"
    fi
  fi

  echo ""

  # Move to next chunk (add 7 days)
  current_date=$(($chunk_end + 86400))
  chunk_num=$((chunk_num + 1))

  # Small delay to avoid rate limits
  sleep 2
done

echo "✅ Backfill complete!"
echo ""
echo "To verify, run this SQL query:"
echo "SELECT COUNT(*) as total_users, MAX(updated_at) as latest_sync FROM subscribers_insights;"

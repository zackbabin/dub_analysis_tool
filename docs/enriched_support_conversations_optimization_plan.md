# Enriched Support Conversations View - Performance Optimization Plan

## Current Issues

The `enriched_support_conversations` materialized view is causing database crashes because:

1. **Full table scan on refresh**: Joins all conversations (thousands) with all messages (tens of thousands)
2. **Memory exhaustion**: ARRAY_AGG on all messages can create huge arrays
3. **Blocking locks**: REFRESH MATERIALIZED VIEW locks the entire view during rebuild
4. **No incremental updates**: Every refresh rebuilds everything from scratch

## Optimization Strategies

### 🚀 Strategy 1: Incremental Refresh (RECOMMENDED - Implement First)

**Concept**: Only refresh conversations that have changed since last refresh

**Implementation**:

```sql
-- Add tracking columns to base tables
ALTER TABLE raw_support_conversations
ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMP;

ALTER TABLE support_conversation_messages
ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMP;

-- Create function to refresh only changed conversations
CREATE OR REPLACE FUNCTION refresh_enriched_support_conversations_incremental()
RETURNS TABLE(conversations_updated INT) AS $$
DECLARE
  conversations_updated INT;
  last_refresh_time TIMESTAMP;
BEGIN
  -- Get last refresh time
  SELECT MAX(synced_at) INTO last_refresh_time
  FROM enriched_support_conversations;

  -- If no previous refresh, do full refresh
  IF last_refresh_time IS NULL THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_support_conversations;
    GET DIAGNOSTICS conversations_updated = ROW_COUNT;
    RETURN QUERY SELECT conversations_updated;
  END IF;

  -- Find conversations that need updating
  WITH conversations_to_update AS (
    SELECT DISTINCT c.id
    FROM raw_support_conversations c
    LEFT JOIN support_conversation_messages m ON c.id = m.conversation_id
    WHERE c.updated_at > last_refresh_time
       OR m.created_at > last_refresh_time
  ),
  -- Delete old entries for changed conversations
  deleted AS (
    DELETE FROM enriched_support_conversations
    WHERE id IN (SELECT id FROM conversations_to_update)
  ),
  -- Insert updated entries
  inserted AS (
    INSERT INTO enriched_support_conversations
    SELECT
      c.id, c.source, c.external_id, c.title, c.description,
      c.status, c.priority, c.created_at, c.updated_at, c.resolved_at,
      c.user_uuid, c.user_id, c.assignee_id, c.tags, c.custom_fields,
      c.raw_data, c.synced_at, c.has_linear_ticket, c.linear_issue_id,
      c.linear_custom_field_id,
      u.income, u.net_worth, u.investing_activity,
      u.total_copies, u.total_subscriptions, u.app_sessions,
      COUNT(m.id),
      ARRAY_AGG(m.body ORDER BY m.created_at) FILTER (WHERE m.body IS NOT NULL),
      li.identifier, li.title, li.state_name, li.url
    FROM raw_support_conversations c
    LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
    LEFT JOIN support_conversation_messages m ON c.id = m.conversation_id
    LEFT JOIN linear_issues li ON c.linear_issue_id = li.id
    WHERE c.id IN (SELECT id FROM conversations_to_update)
    GROUP BY c.id, c.source, c.external_id, c.title, c.description,
             c.status, c.priority, c.created_at, c.updated_at, c.resolved_at,
             c.user_uuid, c.user_id, c.assignee_id, c.tags, c.custom_fields,
             c.raw_data, c.synced_at, c.has_linear_ticket, c.linear_issue_id,
             c.linear_custom_field_id, u.income, u.net_worth, u.investing_activity,
             u.total_copies, u.total_subscriptions, u.app_sessions,
             li.identifier, li.title, li.state_name, li.url
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO conversations_updated FROM inserted;

  RETURN QUERY SELECT conversations_updated;
END;
$$ LANGUAGE plpgsql;
```

**Benefits**:
- ✅ Only processes changed data (99% faster for incremental updates)
- ✅ No full table scan
- ✅ Smaller memory footprint
- ✅ Shorter lock time

**Tradeoffs**:
- ⚠️ More complex logic
- ⚠️ Need to track last refresh time

---

### ⚡ Strategy 2: Time-Based Partitioning

**Concept**: Only materialize recent conversations (last 30-90 days)

```sql
-- Convert to regular view with WHERE clause
DROP MATERIALIZED VIEW enriched_support_conversations;

CREATE VIEW enriched_support_conversations AS
SELECT
  c.id, c.source, c.external_id, c.title, c.description,
  c.status, c.priority, c.created_at, c.updated_at, c.resolved_at,
  c.user_uuid, c.user_id, c.assignee_id, c.tags, c.custom_fields,
  c.raw_data, c.synced_at, c.has_linear_ticket, c.linear_issue_id,
  c.linear_custom_field_id,
  u.income, u.net_worth, u.investing_activity,
  u.total_copies, u.total_subscriptions, u.app_sessions,
  COUNT(m.id) as message_count,
  ARRAY_AGG(m.body ORDER BY m.created_at) FILTER (WHERE m.body IS NOT NULL) as all_messages,
  li.identifier, li.title, li.state_name, li.url
FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN support_conversation_messages m ON c.id = m.conversation_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.id
WHERE c.created_at >= NOW() - INTERVAL '90 days'  -- Only last 90 days
GROUP BY
  c.id, c.source, c.external_id, c.title, c.description,
  c.status, c.priority, c.created_at, c.updated_at, c.resolved_at,
  c.user_uuid, c.user_id, c.assignee_id, c.tags, c.custom_fields,
  c.raw_data, c.synced_at, c.has_linear_ticket, c.linear_issue_id,
  c.linear_custom_field_id, u.income, u.net_worth, u.investing_activity,
  u.total_copies, u.total_subscriptions, u.app_sessions,
  li.identifier, li.title, li.state_name, li.url;
```

**Benefits**:
- ✅ 70-90% reduction in rows processed
- ✅ No refresh needed (always current)
- ✅ Simpler to maintain

**Tradeoffs**:
- ⚠️ Historical data not accessible via view
- ⚠️ Slightly slower queries (no materialization)

---

### 🎯 Strategy 3: Denormalize Messages (BEST for Scale)

**Concept**: Store message count and summary in `raw_support_conversations` table directly

```sql
-- Add columns to raw_support_conversations
ALTER TABLE raw_support_conversations
ADD COLUMN IF NOT EXISTS message_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS message_summary TEXT;

-- Create trigger to update on new messages
CREATE OR REPLACE FUNCTION update_conversation_message_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE raw_support_conversations
    SET
      message_count = message_count + 1,
      last_message_at = GREATEST(last_message_at, NEW.created_at),
      message_summary = COALESCE(message_summary || E'\n---\n', '') ||
                        LEFT(NEW.body, 200)
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_conversation_stats
AFTER INSERT ON support_conversation_messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_message_stats();

-- Simplified materialized view (no message aggregation)
CREATE MATERIALIZED VIEW enriched_support_conversations_fast AS
SELECT
  c.id, c.source, c.external_id, c.title, c.description,
  c.status, c.priority, c.created_at, c.updated_at, c.resolved_at,
  c.user_uuid, c.user_id, c.assignee_id, c.tags, c.custom_fields,
  c.raw_data, c.synced_at, c.has_linear_ticket, c.linear_issue_id,
  c.linear_custom_field_id,
  c.message_count,  -- Pre-computed
  c.last_message_at, -- Pre-computed
  c.message_summary, -- Pre-computed
  u.income, u.net_worth, u.investing_activity,
  u.total_copies, u.total_subscriptions, u.app_sessions,
  li.identifier, li.title, li.state_name, li.url
FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.id;
-- No GROUP BY needed!
```

**Benefits**:
- ✅ No GROUP BY or ARRAY_AGG (10-100x faster)
- ✅ Real-time updates via trigger
- ✅ Minimal refresh time (just joins, no aggregation)
- ✅ Scales to millions of messages

**Tradeoffs**:
- ⚠️ Doesn't store full message array (only summary)
- ⚠️ Need to backfill existing data
- ⚠️ Slight overhead on message insert

---

### 🔧 Strategy 4: Split into Multiple Views

**Concept**: Separate concerns into different views

```sql
-- View 1: Basic conversation enrichment (fast)
CREATE MATERIALIZED VIEW conversations_enriched_basic AS
SELECT
  c.id, c.source, c.external_id, c.title, c.description,
  c.status, c.priority, c.created_at, c.updated_at, c.resolved_at,
  c.user_uuid, c.user_id, c.assignee_id, c.tags, c.custom_fields,
  u.income, u.net_worth, u.investing_activity,
  u.total_copies, u.total_subscriptions, u.app_sessions,
  li.identifier, li.title, li.state_name, li.url
FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.id;

-- View 2: Message aggregation (only when needed)
CREATE MATERIALIZED VIEW conversation_messages_aggregated AS
SELECT
  conversation_id,
  COUNT(id) as message_count,
  ARRAY_AGG(body ORDER BY created_at) FILTER (WHERE body IS NOT NULL) as all_messages,
  MAX(created_at) as last_message_at
FROM support_conversation_messages
GROUP BY conversation_id;

-- Join views only when full data needed
CREATE VIEW enriched_support_conversations_full AS
SELECT
  c.*,
  m.message_count,
  m.all_messages,
  m.last_message_at
FROM conversations_enriched_basic c
LEFT JOIN conversation_messages_aggregated m ON c.id = m.conversation_id;
```

**Benefits**:
- ✅ Can refresh each view independently
- ✅ Use basic view for most queries (fast)
- ✅ Only use full view when messages needed

**Tradeoffs**:
- ⚠️ More views to manage
- ⚠️ Need to refresh both views

---

## 📊 Recommended Implementation Order

### Phase 1: Quick Win (1-2 hours)
1. ✅ **DONE**: Disable auto-refresh in sync pipeline
2. **Implement Strategy 2 (Time-based partitioning)**
   - Add WHERE clause to limit to 90 days
   - Convert to regular view (no materialization)
   - Test performance

### Phase 2: Medium-term (1 day)
3. **Implement Strategy 3 (Denormalization)**
   - Add message_count, last_message_at columns
   - Create trigger for real-time updates
   - Backfill existing data
   - Rebuild view without GROUP BY

### Phase 3: Long-term (2-3 days)
4. **Implement Strategy 1 (Incremental refresh)**
   - Add tracking columns
   - Build incremental refresh function
   - Test with production data
   - Schedule periodic incremental refreshes

### Phase 4: Scale (if needed)
5. **Consider Strategy 4 (Split views)**
   - Only if hitting performance limits again
   - Separate message aggregation from enrichment

---

## 🎯 Immediate Action Items

1. **Set analysis lookback to 30 days** (if not already):
   ```sql
   -- Limit analysis to recent conversations
   UPDATE support_sync_status
   SET last_sync_timestamp = NOW() - INTERVAL '30 days'
   WHERE source = 'zendesk';
   ```

2. **Add index on created_at** (if not exists):
   ```sql
   CREATE INDEX IF NOT EXISTS idx_raw_conversations_created_at
   ON raw_support_conversations(created_at DESC);
   ```

3. **Monitor view size**:
   ```sql
   SELECT
     schemaname,
     matviewname,
     pg_size_pretty(pg_total_relation_size(schemaname||'.'||matviewname)) AS size
   FROM pg_matviews
   WHERE matviewname = 'enriched_support_conversations';
   ```

---

## 📈 Expected Performance Improvements

| Strategy | Refresh Time | Memory Usage | Complexity |
|----------|-------------|--------------|------------|
| **Current** | 2-5 min ⛔ | Very High ⛔ | Low ✅ |
| **Strategy 1 (Incremental)** | 5-30 sec ✅ | Medium ⚠️ | High ⚠️ |
| **Strategy 2 (Partitioned)** | N/A (view) ✅ | Low ✅ | Low ✅ |
| **Strategy 3 (Denormalized)** | 1-10 sec ✅ | Very Low ✅ | Medium ⚠️ |
| **Strategy 4 (Split)** | 30-60 sec ✅ | Medium ⚠️ | Medium ⚠️ |

---

## 🚨 Emergency Procedures

If database crashes again:

1. **Check for long-running queries**:
   ```sql
   SELECT pid, now() - query_start as duration, query
   FROM pg_stat_activity
   WHERE state = 'active'
   ORDER BY duration DESC;
   ```

2. **Kill blocking queries**:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE query LIKE '%enriched_support%'
     AND state = 'active'
     AND now() - query_start > interval '5 minutes';
   ```

3. **Drop the view temporarily**:
   ```sql
   DROP MATERIALIZED VIEW IF EXISTS enriched_support_conversations;
   ```

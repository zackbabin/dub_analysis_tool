# Dub Analysis Tool

Comprehensive analytics platform for analyzing user behavior, creator performance, and business metrics for an investment social network.

## System Architecture

**Frontend**: Static HTML/CSS/JS hosted on GitHub Pages
**Backend**: Supabase (PostgreSQL + Edge Functions)
**Data Source**: Mixpanel Analytics API
**AI Analysis**: Claude Sonnet 4 (Anthropic)

---

## 1. User Analysis Tool

Analyzes user behavior patterns to identify what actions predict conversions (copies and subscriptions).

### Core Analyses

#### 1.1 Main Analysis
**Purpose**: Comprehensive user journey metrics and conversion funnels

**Data Flow**:
```
sync-mixpanel-users → subscribers_insights table → Main Analysis Dashboard
```

**What it analyzes**:
- User demographics (income, net worth, investing experience)
- Engagement metrics (app sessions, tab views, card taps)
- Conversion metrics (copies, subscriptions, deposits)
- Account activation (linked bank, buying power, deposits)

#### 1.2 Pattern Combination Analysis (Statistical)
**Purpose**: Identify which creator pairs drive conversions using logistic regression

**Data Flow**:
```
sync-mixpanel-engagement → user_portfolio_creator_engagement table
                         ↓
                    analyze-subscription-patterns
                    analyze-copy-patterns
                    analyze-creator-copy-patterns
                         ↓
              conversion_pattern_combinations table
```

**Process**:
1. Load all user-portfolio-creator engagement pairs (with pagination)
2. Convert pairs to user-level data (which creators/portfolios each user viewed)
3. Generate all 2-element combinations (creators or portfolios)
4. For each combination, test if users who viewed BOTH convert more
5. Calculate statistical metrics (lift, conversion rates)
6. Rank combinations by Expected Value (lift × total conversions)

**Key Metrics**:
- **Lift**: Conversion rate in group / overall conversion rate
- **Conversion Rate in Group**: % of exposed users who converted
- **Total Conversions**: Total copies/subscriptions from exposed group
- **Users with Exposure**: Sample size for validation

**Auto-triggered**: Runs automatically after `sync-mixpanel-engagement` (fire-and-forget)

#### 1.3 Event Sequences Analysis (AI-Powered)
**Purpose**: Discover temporal behavioral patterns using Claude AI

**Data Flow**:
```
event_sequences_raw (raw events stored in database)
                           ↓
                   user_event_sequences table (with conversion outcomes)
                           ↓
                   analyze-event-sequences (Claude AI analysis)
                           ↓
                   event_sequence_analysis table
```

**Process**:
1. **Analyze Existing Sequences** (`analyze-event-sequences`):
   - Loads converters vs non-converters from `user_event_sequences`
   - Sends balanced datasets to Claude (100 converters + 100 non-converters per batch)
   - Claude identifies:
     - **Predictive Sequences**: Ordered events that predict conversion (e.g., Profile → PDP → Paywall)
     - **Critical Triggers**: Last events before conversion
     - **Anti-Patterns**: Sequences common in non-converters
     - **Time Windows**: Average time between key events
   - Uses prompt caching to reduce costs (2k tokens cached across batches)
   - Processes up to 600 users (3 batches max)
   - Cost optimized: 50 events per user, ~77k tokens per batch (38% of 200k limit)

**Trigger**: Manual only (costs Claude API tokens ~$1.71 per run)

**Output**: Natural language insights with actionable recommendations

#### 1.4 Time Funnels Analysis
**Purpose**: Track time-to-conversion for key user milestones

**Data Flow**:
```
sync-mixpanel-funnels → time_funnels table → Funnels Dashboard
```

**Funnel Types**:
- Time to First Copy
- Time to First Subscription
- Time to Linked Bank Account
- Time to First Deposit

**Status**: Currently disabled (causes Mixpanel rate limits - uses 3 concurrent queries)

#### 1.5 Hidden Gems Analysis
**Purpose**: Identify high-engagement portfolios with low conversion rates

**Data Flow**:
```
user_portfolio_creator_engagement → portfolio_creator_engagement_metrics (materialized view)
                                  → hidden_gems_portfolios (materialized view)
```

**What it identifies**:
- Portfolios with high PDP views or profile views (top 50%)
- But low copy conversion rates (≤25%)
- Suggests optimization opportunities for underperforming portfolios

**Used for**: Identifying undervalued portfolios that attract attention but don't convert

### User Analysis Sync Workflow

**Full Sync** (run via "Sync Live Data" button):
```
1. sync-mixpanel-users (subscribers data - 30-60s)
2. [sync-mixpanel-funnels - DISABLED]
3. sync-mixpanel-engagement (views, subs, copies - 60-90s)
   └─> Auto-triggers: analyze-subscription-patterns
                      analyze-copy-patterns
                      analyze-creator-copy-patterns

Total: ~2-3 minutes
```

**Event Sequences Workflow** (manual, separate):
```
analyze-event-sequences (Claude AI - 60-120s)
   Input: { outcome_type: 'copies' | 'subscriptions' }
   Uses: Existing user_event_sequences table data
```

---

## 2. Creator Analysis Tool

Analyzes creator performance metrics and identifies top performers.

### Core Analyses

#### 2.1 Creator Insights
**Purpose**: Track creator-level engagement and revenue metrics

**Data Flow**:
```
sync-creator-data → creators_insights table → Creator Analysis Dashboard
```

**Metrics Tracked**:
- Profile views, PDP views, paywall views, Stripe modal views
- Total subscriptions, subscription revenue
- Cancelled/expired subscriptions
- Total copies, investment count, investment volume
- All stored in flexible JSONB format for new metrics

#### 2.2 Subscription Price Analysis
**Purpose**: Break down creator subscriptions by price point and interval

**Data Flow**:
```
sync-mixpanel-engagement → creator_subscriptions_by_price table
```

**What it tracks**:
- Creator ID + username
- Subscription price + interval (monthly/yearly)
- Total subscriptions + paywall views at each price point
- Enables price elasticity analysis

#### 2.3 Uploaded Creator Enrichment
**Purpose**: Merge uploaded CSV data with Mixpanel metrics for correlation analysis

**Data Flow**:
```
upload-and-merge-creator-files → creator_uploads table
                                     ↓
sync-creator-data → creators_insights table (Mixpanel user profiles)
                                     ↓
                           creator_analysis view
                           (joins creator_uploads + creators_insights + event tables)
                                     ↓
                           Extracts: type, total_copies, total_subscriptions
                           Merges: Mixpanel enrichment into raw_data JSONB
```

**Process**:
1. User uploads 3 CSV files (Creator List, Deals, Public Creators)
2. Function merges files using two-stage matching (name → email)
3. Stores merged data in `creator_uploads` table with all fields in `raw_data` JSONB
4. User triggers "Sync Live Data" to enrich with Mixpanel user profiles
5. `creator_analysis` view:
   - Shows most recent upload batch only
   - Aggregates `total_copies` from `user_portfolio_creator_engagement` table
   - Aggregates `total_subscriptions` from `creator_subscriptions_by_price` table
   - Joins `creators_insights` to merge Mixpanel enrichment into raw_data
   - Extracts `type` field from raw_data
6. Analysis extracts all numeric fields from `raw_data` for correlation

**Mixpanel Metrics Merged**:
- total_deposits, active_created_portfolios, lifetime_created_portfolios
- total_trades, investing_activity, investing_experience_years
- investing_objective, investment_type

**Use Case**: Identify which creator attributes (demographics, behavior) predict copies/subscriptions

### Creator Analysis Sync Workflow

**Complete Workflow**:
```
1. User uploads 3 CSV files → stored in creator_uploads
2. User clicks "Sync Live Data" → enriches creators_insights from Mixpanel
3. creator_analysis view merges both datasets
4. Analysis runs correlation on all fields in raw_data
5. Display shows: Total Creators, Core Creators (Regular), Premium Creators
```

---

## 3. Business Model Analysis Tool

Analyzes revenue projections and business assumptions.

### Core Analyses

#### 3.1 Business Assumptions Management
**Purpose**: Configure and track business model parameters

**Data Source**: `business_assumptions` table

**Configurable Parameters**:

**Revenue Metrics**:
- Regular copy rate
- Premium copy rate
- Premium copy multiplier
- Subscription price (monthly/yearly)
- Rebalance fee percentage

**User Behavior**:
- Monthly new user growth rate
- Monthly churn rate
- Regular-to-premium conversion rate
- Portfolio rebalance frequency

**Conversion Rates** (updated from pattern analysis):
- View → Copy conversion rate
- View → Subscription conversion rate
- Portfolio creator → Subscription rate

#### 3.2 Subscription Pattern Analysis Integration
**Purpose**: Auto-update business assumptions with real conversion data

**Data Flow**:
```
sync-business-assumptions → Reads conversion_pattern_combinations
                          → Calculates median conversion rates
                          → Updates business_assumptions table
```

**Auto-triggered**: Runs after subscription pattern analysis completes

**What it updates**:
- `view_to_copy_rate`: Median conversion rate from top 10 copy patterns
- `view_to_subscription_rate`: Median conversion rate from top 10 subscription patterns

### Business Model Sync Workflow

**Automatic** (runs after user analysis):
```
analyze-subscription-patterns → sync-business-assumptions
analyze-copy-patterns         → sync-business-assumptions
```

**Manual Configuration**: Update via dashboard UI (stores in `business_assumptions` table)

---

## Database Schema

### User Analysis Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `subscribers_insights` | User profiles & metrics | distinct_id, income, total_copies, total_subscriptions |
| `user_portfolio_creator_engagement` | Consolidated engagement tracking | distinct_id, creator_id, portfolio_ticker, did_subscribe, did_copy, view counts |
| `user_portfolio_creator_views` (view) | Subscription-focused view | Filters engagement table for subscriptions |
| `user_portfolio_creator_copies` (view) | Copy-focused view | Filters engagement table for copies |
| `time_funnels` | Time-to-conversion funnels | distinct_id, funnel_type, time_to_convert |
| `event_sequences_raw` | Raw event sequences | distinct_id, event_data (JSONB array) |
| `user_event_sequences` | Processed sequences | distinct_id, event_sequence, total_copies, total_subscriptions |
| `event_sequence_analysis` | AI analysis results | analysis_type, predictive_sequences, recommendations |
| `conversion_pattern_combinations` | Statistical patterns | analysis_type, value_1, value_2, lift, conversion_rate_in_group |
| `main_analysis` (mat. view) | Combined user metrics | Joins subscribers_insights + engagement + time_funnels |

### Creator Analysis Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `creators_insights` | Mixpanel user profiles | email, total_deposits, active_created_portfolios, investing_activity |
| `creator_subscriptions_by_price` | Price point breakdown | creator_username, subscription_price, total_subscriptions |
| `creator_uploads` | Uploaded creator data | email, creator_username, raw_data (JSONB), uploaded_at |
| `creator_analysis` (view) | Merged analysis data | Joins creator_uploads + creators_insights + aggregated engagement; outputs: type, total_copies, total_subscriptions, raw_data |
| `portfolio_creator_engagement_metrics` (mat. view) | Portfolio-creator metrics | Aggregates engagement by portfolio/creator |
| `hidden_gems_portfolios` (mat. view) | Underperforming portfolios | High views, low conversion portfolios |

### Business Model Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `business_assumptions` | Model parameters | assumption_name, assumption_value, updated_at |

### System Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `sync_logs` | Track sync history | tool_type, sync_status, sync_started_at, records_inserted |

---

## Edge Functions Reference

### User Analysis Functions

| Function | Trigger | Duration | Purpose |
|----------|---------|----------|---------|
| `sync-mixpanel-users` | Manual | 30-60s | Fetch subscriber profiles |
| `sync-mixpanel-funnels` | Disabled | - | Fetch time funnels (rate limited) |
| `sync-mixpanel-engagement` | Manual | 60-90s | Fetch views, subs, copies into consolidated table |
| `analyze-subscription-patterns` | Auto | 30-60s | Statistical creator pair analysis for subscriptions |
| `analyze-copy-patterns` | Auto | 30-60s | Statistical portfolio pair analysis for copies |
| `analyze-creator-copy-patterns` | Auto | 30-60s | Statistical creator pair analysis for copies |
| `analyze-event-sequences` | Manual | 60-120s | Claude AI pattern analysis (600 users, $1.71/run) |

### Creator Analysis Functions

| Function | Trigger | Duration | Purpose |
|----------|---------|----------|---------|
| `sync-creator-data` | Manual | 30-60s | Fetch creator metrics |
| `upload-and-merge-creator-files` | Manual | 5-15s | Process uploaded CSVs |

### Business Model Functions

| Function | Trigger | Duration | Purpose |
|----------|---------|----------|---------|
| `sync-business-assumptions` | Auto | 1-2s | Update model parameters |

---

## API Integrations

### Mixpanel API
- **Base URL**: `https://mixpanel.com/api`
- **Auth**: Basic auth (username + service account secret)
- **Rate Limits**: 5 concurrent requests, 60 requests/hour
- **Retry Logic**: Automatic retry on 502/503/504 errors (up to 2 retries)

### Anthropic Claude API
- **Model**: `claude-sonnet-4-20250514`
- **Features**: Prompt caching (2k tokens cached)
- **Cost**: ~$1.71 per event sequence analysis (600 users, 50 events each)
- **Token Limits**: 200k per request (functions use ~77k tokens = 38% of limit)
- **Rate Limits**: Handled with exponential backoff

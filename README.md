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
sync-mixpanel-engagement → user_portfolio_creator_views
                         → user_portfolio_creator_copies
                         ↓
                    analyze-subscription-patterns
                    analyze-copy-patterns
                         ↓
              conversion_pattern_combinations table
```

**Process**:
1. Load all user-creator view/copy pairs (with pagination)
2. Convert pairs to user-level data (which creators each user viewed)
3. Generate all 2-creator combinations
4. For each combination, test if users who viewed BOTH creators convert more
5. Calculate statistical metrics (odds ratio, lift, precision, recall, AIC)
6. Rank combinations by predictive power

**Key Metrics**:
- **Odds Ratio**: How much more likely to convert if exposed to combination
- **Lift**: Conversion rate in group / overall conversion rate
- **Precision**: % of exposed users who converted
- **Users with Exposure**: Sample size for validation

**Auto-triggered**: Runs automatically after `sync-mixpanel-engagement` (fire-and-forget)

#### 1.3 Event Sequences Analysis (AI-Powered)
**Purpose**: Discover temporal behavioral patterns using Claude AI

**Data Flow**:
```
sync-event-sequences → event_sequences_raw (enriched events)
                           ↓
                   enrich-event-sequences (add portfolio/creator context)
                           ↓
                   process-event-sequences (join conversion outcomes)
                           ↓
                   user_event_sequences table
                           ↓
                   analyze-event-sequences (Claude AI analysis)
                           ↓
                   event_sequence_analysis table
```

**Process**:
1. **Fetch Raw Events** (`sync-event-sequences`):
   - Fetches user event sequences from Mixpanel (Chart 85247935)
   - Stores raw event data with timestamps
   - Up to 50,000 user sequences

2. **Enrich Events** (`enrich-event-sequences`):
   - Adds contextual properties to events:
     - PDP views: `"Viewed Premium PDP ($PELOSI by @dubAdvisors)"`
     - Profile views: `"Viewed Creator Profile (@brettsimba)"`
   - Fetches from 2 additional Mixpanel charts for enrichment
   - ~60% enrichment coverage

3. **Join Outcomes** (`process-event-sequences`):
   - Joins event sequences with `subscribers_insights`
   - Adds conversion outcomes: `total_copies`, `total_subscriptions`
   - Fast database-only operation

4. **AI Analysis** (`analyze-event-sequences`):
   - Loads converters vs non-converters
   - Sends balanced datasets to Claude (150 converters + 150 non-converters per batch)
   - Claude identifies:
     - **Predictive Sequences**: Ordered events that predict conversion (e.g., Profile → PDP → Paywall)
     - **Critical Triggers**: Last events before conversion
     - **Anti-Patterns**: Sequences common in non-converters
     - **Time Windows**: Average time between key events
     - **Top Portfolios/Creators**: Which specific ones drive conversions
   - Uses prompt caching to reduce costs (40k tokens cached across batches)
   - Processes up to 3,000 users (10 batches max)

**Trigger**: Manual only (costs Claude API tokens ~$1.50-$3.00 per run)

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

#### 1.5 Portfolio View Events Analysis
**Purpose**: Analyze raw portfolio view event streams

**Data Flow**:
```
sync-mixpanel-portfolio-events → portfolio_view_events table → Hidden Gems Analysis
```

**What it tracks**:
- Individual portfolio view events with timestamps
- Portfolio ticker, creator info, event type (premium vs regular)
- High-volume dataset (100k+ events)

**Used for**: Identifying undervalued portfolios ("Hidden Gems")

### User Analysis Sync Workflow

**Full Sync** (run via "Sync Live Data" button):
```
1. sync-mixpanel-users (subscribers data - 30-60s)
2. [sync-mixpanel-funnels - DISABLED]
3. sync-mixpanel-engagement (views, subs, copies - 60-90s)
   └─> Auto-triggers: analyze-subscription-patterns + analyze-copy-patterns
4. sync-mixpanel-portfolio-events (raw events - 30-60s)

Total: ~2-3 minutes
```

**Event Sequences Workflow** (manual, separate):
```
1. sync-event-sequences (fetch from Mixpanel - 60-120s)
2. enrich-event-sequences (add context - 30-60s)
3. process-event-sequences (join outcomes - 10-20s)
4. analyze-event-sequences (Claude AI - 60-120s)
   Input: { outcome_type: 'copies' | 'subscriptions' }

Total: ~3-5 minutes
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
**Purpose**: Merge uploaded CSV data with Mixpanel metrics

**Data Flow**:
```
upload-and-merge-creator-files → uploaded_creators table
                                     ↓
                           creator_analysis view
                           (merges uploaded + Mixpanel data)
```

**Process**:
1. User uploads multiple CSV files via drag-and-drop
2. Function merges files, deduplicates by email
3. Stores raw data as JSONB (flexible schema)
4. View joins with `creators_insights` for enrichment

**Use Case**: Import creator contact lists, demographics, or custom attributes

### Creator Analysis Sync Workflow

**Manual Sync**:
```
sync-creator-data → Refreshes creators_insights from Mixpanel
```

**Upload Workflow**:
```
1. User uploads CSV file(s)
2. upload-and-merge-creator-files processes and stores
3. creator_analysis view auto-updates with latest upload
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
| `user_portfolio_creator_views` | User-creator view pairs | distinct_id, creator_id, did_subscribe, view counts |
| `user_portfolio_creator_copies` | User-creator copy pairs | distinct_id, creator_id, did_copy, copy counts |
| `time_funnels` | Time-to-conversion funnels | distinct_id, funnel_type, time_to_convert |
| `portfolio_view_events` | Raw event stream | distinct_id, portfolio_ticker, creator_id, event_time |
| `event_sequences_raw` | Raw event sequences | distinct_id, event_data (JSONB array) |
| `user_event_sequences` | Processed sequences | distinct_id, event_sequence, total_copies, total_subscriptions |
| `event_sequence_analysis` | AI analysis results | analysis_type, predictive_sequences, recommendations |
| `conversion_pattern_combinations` | Statistical patterns | analysis_type, value_1, value_2, lift, odds_ratio |

### Creator Analysis Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `creators_insights` | Creator metrics | creator_id, creator_username, metrics (JSONB) |
| `creator_subscriptions_by_price` | Price point breakdown | creator_id, price, interval, total_subscriptions |
| `uploaded_creators` | Uploaded creator data | email, creator_username, raw_data (JSONB) |

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
| `sync-mixpanel-engagement` | Manual | 60-90s | Fetch views, subs, copies |
| `sync-mixpanel-portfolio-events` | Manual | 30-60s | Fetch raw portfolio events |
| `analyze-subscription-patterns` | Auto | 30-60s | Statistical creator pair analysis |
| `analyze-copy-patterns` | Auto | 30-60s | Statistical creator pair analysis |
| `sync-event-sequences` | Manual | 60-120s | Fetch raw event sequences |
| `enrich-event-sequences` | Manual | 30-60s | Add portfolio/creator context |
| `process-event-sequences` | Manual | 10-20s | Join conversion outcomes |
| `analyze-event-sequences` | Manual | 60-120s | Claude AI pattern analysis |

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
- **Features**: Prompt caching (40k tokens cached)
- **Cost**: ~$1.50-$3.00 per event sequence analysis
- **Rate Limits**: Handled with exponential backoff

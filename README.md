# Dub Analysis Tool

**Version**: 2.1.0 (November 2024)

Comprehensive analytics platform for analyzing user behavior, creator performance, and business metrics for an investment social network.

## System Architecture

**Frontend**: Static HTML/CSS/JS hosted on GitHub Pages
**Backend**: Supabase (PostgreSQL + Edge Functions)
**Data Sources**: Mixpanel Analytics API, Zendesk Support API, Linear API
**AI Analysis**: Claude Sonnet 4 (Anthropic)

## Tool Tabs

1. **Summary Stats** - High-level marketing and platform metrics
2. **Behavior Analysis** - User journey and conversion analysis
3. **CX Analysis** - Support feedback and issue prioritization
4. **Premium Creator Analysis** - Creator performance and correlation analysis
5. **Crypto Business Analysis** - Revenue projections and business modeling

---

## Tab 1: Summary Stats

Displays high-level platform health metrics for marketing and executive reporting.

### Marketing Metrics (Manual Fetch)

**Data Source**: Mixpanel Insights API (on-demand fetch, not automated)

**Metrics Displayed**:
- **Avg Monthly Copies** - Average copies per month from chart 86100814
- **Total Investments** - Total investment volume (future)
- **Total Public Portfolios** - Count of public portfolios
- **Total Market-Beating Portfolios** - Count outperforming benchmarks (future)

**Trigger**: Manual "Fetch Marketing Data" button (fetches latest from Mixpanel)

**Note**: These are snapshot metrics for reporting, not synced to database

---

## Tab 2: Behavior Analysis

Analyzes user behavior patterns to identify what actions predict conversions (copies and subscriptions).

### Data Sources

**Event Metrics** (from Mixpanel Insights API):
- 17 pre-aggregated metrics: total copies, bank links, app sessions, tab views, creator/portfolio views, subscriptions, etc.
- Synced daily via `sync-mixpanel-user-events-v2`

**User Properties** (from Mixpanel Engage API):
- 15 properties: income, net worth, investing activity, buying power, portfolios created/copied, deposits, etc.
- Synced daily via `sync-mixpanel-user-properties-v2`

**Engagement Data** (from Mixpanel Insights API):
- Granular user-portfolio-creator engagement: profile views, PDP views, copies, liquidations, subscriptions
- Synced daily via `sync-mixpanel-engagement` (3 charts: profile views, PDP views/copies, subscriptions)

### Core Analyses

#### 1.1 Main Analysis
**Purpose**: Comprehensive user journey metrics and conversion funnels

**What it shows**:
- User demographics and investment experience
- Engagement patterns across app features
- Conversion funnels for copies and subscriptions
- Account activation metrics

#### 1.2 Pattern Combination Analysis
**Purpose**: Identify which creator/portfolio pairs drive the highest conversions

**What it does**:
- Tests all 2-element combinations to find pairs that convert better together
- Calculates lift (how much better the pair converts vs. baseline)
- Ranks by expected value (lift × total conversions)
- Auto-triggered after engagement sync completes

#### 1.3 Event Sequences Analysis (AI)
**Purpose**: Discover behavioral patterns that predict conversions using Claude AI

**What it finds**:
- Predictive sequences (e.g., Profile → PDP → Paywall)
- Critical trigger events before conversion
- Anti-patterns common in non-converters
- Timing patterns between key events

**Trigger**: Manual only (~$1.71 per run, analyzes 600 users)

#### 1.4 Time Funnels Analysis
**Purpose**: Track time-to-conversion for key milestones

**Status**: Currently disabled (causes Mixpanel rate limits)

#### 1.5 Hidden Gems Analysis
**Purpose**: Identify portfolios with high engagement but low conversion rates (optimization opportunities)

### Sync Workflow

**Manual Sync** (via "Sync Live Data" button):
1. `sync-mixpanel-user-events-v2` - Event metrics from Insights API (~2-5 min)
2. `sync-mixpanel-user-properties-v2` - User properties from Engage API (~5-10 min)
3. `sync-mixpanel-engagement` - Granular engagement data (~60-90s)
   - Frontend orchestrates 3 steps: fetch → process-portfolio → process-creator
4. `sync-creator-data` - Creator performance metrics (~30s)
5. `sync-support-conversations` - Support workflow starter (~30s)
   - Auto-triggers 3-step chain: sync-linear-issues → analyze-support-feedback → map-linear-to-feedback
   - Background completion: ~2-3 min total
6. `sync-event-sequences` - Raw event data for pattern analysis
7. `process-event-sequences` - Join with conversion data
8. `analyze-event-sequences` - Claude AI pattern analysis (copies only)
9. `analyze-subscription-price` - Subscription pricing analysis
10. `analyze-copy-patterns` - Portfolio/creator combinations
11. `refresh-materialized-views` - Update all database views (runs in finally block)

**Automatic Daily Sync** (2:00-3:00 AM UTC via cron):
1. `sync-mixpanel-user-events-v2` - Event metrics (~2-5 min)
2. `sync-mixpanel-user-properties-v2` - User properties (~5-10 min)
3. `sync-mixpanel-engagement` - Granular engagement (~60-90s)
   - Auto-triggers pattern analysis functions

---

## Tab 3: CX Analysis

Customer experience analysis powered by AI-driven support ticket categorization and Linear issue mapping.

### Data Sources

**Support Tickets**:
- Zendesk support tickets (last 30 days)
- Instabug bug reports (mobile app)
- User enrichment: income, net worth, investing activity, engagement metrics

**Linear Issues**:
- All issues from "dub 3.0" team
- Mapped to feedback themes via AI semantic matching

### Workflow Architecture

The CX Analysis uses a **4-step fire-and-forget chain** to avoid Edge Function timeouts:

```
Frontend: "Sync Live Data" button
    ↓ (waits for step 1 only)
1. sync-support-conversations (~30s)
   - Fetches Zendesk tickets + Instabug reports
   - Enriches with user data from subscribers_insights
   - Stores in raw_support_conversations table
   - Fire-and-forget trigger → Step 2
    ↓ (background, async)
2. sync-linear-issues (~10s)
   - Fetches Linear issues via GraphQL API
   - Stores in linear_issues table
   - Fire-and-forget trigger → Step 3
    ↓ (background, async)
3. analyze-support-feedback (~45-60s)
   - Reads 300 most recent conversations from enriched_support_conversations
   - Sends to Claude Sonnet 4 (~120K input tokens)
   - Claude categorizes into top 10 issues by priority
   - Stores in support_analysis_results table
   - Fire-and-forget trigger → Step 4
    ↓ (background, async)
4. map-linear-to-feedback (~30-45s)
   - For each of the 10 feedback issues:
     a. Checks for direct Zendesk-Linear integration links
     b. If none found, uses Claude AI semantic matching
   - Sends feedback + all Linear issues to Claude
   - Stores mappings in linear_feedback_mapping table
   - Updates support_analysis_results with Linear data
```

**Total workflow time**: ~2-3 minutes (steps 2-4 run in background)

### What It Shows

**Top 10 Product Issues**:
- Ranked by composite priority score (0-100)
- **Ranking Formula**:
  ```
  Priority Score = (Category Weight × 0.4) + (Percentage × 3 × 0.3) + (Volume/50 × 100 × 0.3)
  ```
  Where:
  - **Category Weight** (40% of score):
    - Compliance: 100 (regulatory risk)
    - Money Movement: 80 (financial operations)
    - Trading: 60 (core functionality)
    - App Functionality: 40 (user experience)
    - Feature Request: 20 (enhancements)
  - **Percentage** (30% of score): % of total conversations affected (multiplied by 3)
  - **Volume** (30% of score): Weekly ticket count (capped at 50, normalized to 0-100)
- Issues sorted by priority score (highest to lowest) to identify most critical problems

**For Each Issue**:
- Issue summary (140 chars max)
- Weekly volume and percentage of total conversations
- 3 representative ticket examples with user segments
- Mapped Linear issues (if any) with status and URLs

**User Segment Analysis**:
- Income bracket, net worth, investing activity
- Total copies, subscriptions, app sessions
- Helps prioritize issues by affected user value

### AI Configuration

**analyze-support-feedback** (Zendesk analysis):
- Model: `claude-sonnet-4-20250514`
- Input: ~120,000 tokens (300 conversations × 400 tokens)
- Output: `max_tokens: 16384` (structured JSON with 10 issues)
- Temperature: `0.3`

**map-linear-to-feedback** (Linear mapping):
- Model: `claude-sonnet-4-20250514`
- Input: ~5,000-20,000 tokens per issue (varies by # of Linear issues)
- Output: `max_tokens: 16384` (JSON array of matches)
- Temperature: `0.3`
- Confidence threshold: ≥0.60 (0.60-0.74: moderate, 0.75-0.89: strong, 0.90-1.00: very strong)

### Data Protection

**PII Redaction**: All sensitive data automatically redacted at ingestion
- SSN, credit card numbers, phone numbers, email addresses
- Redaction happens in `sync-support-conversations` before storage

### Sync Methods

**Manual Sync** (via "Sync Live Data" button):
- Triggers `sync-support-conversations`
- Frontend waits for step 1 to complete (~30s)
- Steps 2-4 continue in background (~2-3 min total)
- Click "Refresh" button on CX tab after ~2-3 min to see results

**Automatic Sync** (daily via pg_cron):
- Runs at 3:30 AM UTC
- Full 4-step workflow completes automatically
- Results visible next morning

### Cost Analysis

**Per Analysis Run**:
- analyze-support-feedback: ~$0.18 (120K input + 10K output tokens)
- map-linear-to-feedback: ~$0.10 (10 calls × ~10K tokens each)
- **Total**: ~$0.28 per analysis

**Monthly Cost** (daily runs): ~$8.40

---

## Tab 4: Premium Creator Analysis

Analyzes premium creator performance and copy behavior patterns.

**Data Sources**:
- Mixpanel Insights API (charts 85165580, 85165590, 85154450, 85130412)
- Synced automatically via daily cron jobs

### Core Analyses

#### Premium Creator Copy Affinity
**Purpose**: Identify which creators are most frequently copied together by the same users

**What it shows**:
- For each premium creator, shows top 5 other creators (premium + regular) that their copiers also copy
- Based on actual user copy behavior patterns
- Helps identify creator clusters and cross-promotion opportunities

#### Premium Creator Breakdown
**Purpose**: Performance metrics for each premium creator

**Metrics tracked**:
- Engagement: profile views, PDP views, paywall views
- Revenue: subscriptions, subscription revenue, cancellations
- Trading: total copies, liquidations, copy capital
- Performance: all-time returns

#### Subscription Price Distribution
**Purpose**: Analyze subscription pricing across premium creators

**What it shows**: Distribution of subscription prices and intervals (monthly/annual)

#### Premium Creator Retention
**Purpose**: Track cohort retention for premium creator subscriptions

**What it shows**: Month-over-month subscription renewal rates by creator

### Manual Data Uploads

#### Portfolio Performance Metrics
**Upload**: CSV files with portfolio performance data (returns, positions, inception dates)

**Endpoint**: `upload-portfolio-metrics?dataType=performance`

**Storage**: `portfolio_performance_metrics` table

#### Portfolio Stock Holdings
**Upload**: CSV files with stock holdings per portfolio (ticker, quantity, position count)

**Endpoint**: `upload-portfolio-metrics?dataType=holdings`

**Storage**: `portfolio_stock_holdings` table

**Note**: Core creator metrics are synced automatically from Mixpanel daily

---

## Tab 5: Crypto Business Analysis

Configurable revenue projections based on user behavior and conversion metrics.

**Key Parameters**:
- Revenue rates (copy fees, subscription prices)
- User behavior (growth rate, churn, rebalance frequency)
- Conversion rates (auto-updated from pattern analysis)

**Auto-sync**: Conversion rates updated after pattern analysis completes

---

## Additional Integrations

### Linear Feedback Mapping

Automatically maps user feedback to Linear issues for product roadmap prioritization using a two-phase matching strategy.

**Data Sources**:
- Support feedback analysis results (top 10 issues from `support_analysis_results`)
- Linear issues from "dub 3.0" team (from `linear_issues` table)
- Zendesk-Linear integration metadata (direct ticket links)

**Matching Strategy** (per feedback issue):

**Phase 1: Direct Integration Links**
- Checks if Zendesk tickets have Linear issues attached via native integration
- Found in `enriched_support_conversations.linear_identifier` field
- No AI needed, 100% confidence

**Phase 2: AI Semantic Matching** (if no direct links found)
- Sends feedback + all Linear issues to Claude Sonnet 4
- Claude analyzes semantic similarity between feedback theme and Linear issue titles/descriptions
- Returns matches with confidence scores ≥0.60
  - 0.90-1.00: Very strong match (same feature/bug)
  - 0.75-0.89: Strong match (related feature)
  - 0.60-0.74: Moderate match (related area)

**Output**:
- Mappings stored in `linear_feedback_mapping` table
- `support_analysis_results` updated with Linear issue IDs, statuses, and URLs
- Enables tracking which Linear issues address which customer pain points

**Automation**:
- **Manual**: Part of 4-step support workflow chain (step 4)
- **Automatic**: Runs daily at ~3:32-3:33 AM UTC (triggered by analyze-support-feedback)

---

## Daily Automation

All syncs run automatically via pg_cron:

**User Analysis** (2:00-3:00 AM UTC):
1. `sync-mixpanel-user-events-v2` - Event metrics from Insights API
2. `sync-mixpanel-user-properties-v2` - User properties from Engage API
3. `sync-mixpanel-engagement` - Granular engagement data
   - Auto-triggers pattern analysis functions

**Creator Analysis** (3:15 AM UTC):
- `sync-creator-data` - Creator performance metrics

**Support Analysis** (3:30 AM UTC start, ~2-3 min total):
1. `sync-support-conversations` - Zendesk/Instabug tickets (~30s)
   - Auto-triggers → `sync-linear-issues`
2. `sync-linear-issues` - Linear "dub 3.0" team issues (~10s)
   - Auto-triggers → `analyze-support-feedback`
3. `analyze-support-feedback` - Claude AI categorization (~45-60s)
   - Auto-triggers → `map-linear-to-feedback`
4. `map-linear-to-feedback` - AI semantic matching (~30-45s)

**Note**: Fire-and-forget chain architecture - each function triggers the next asynchronously

---

## Key Technologies

**Data Pipeline**:
- Mixpanel Insights API (pre-aggregated metrics from saved charts)
- Mixpanel Engage API (user properties, paginated)
- Mixpanel Export API (deprecated - old event streaming approach)

**AI/ML**:
- Claude Sonnet 4 for pattern analysis and categorization
- Logistic regression for statistical pattern combinations

**Infrastructure**:
- Supabase Edge Functions (Deno runtime)
- PostgreSQL with materialized views
- pg_cron for scheduling

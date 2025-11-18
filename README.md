# Dub Analysis Tool

Comprehensive analytics platform for analyzing user behavior, creator performance, and business metrics for an investment social network.

## System Architecture

**Frontend**: Static HTML/CSS/JS hosted on GitHub Pages
**Backend**: Supabase (PostgreSQL + Edge Functions)
**Data Sources**: Mixpanel Analytics API, Zendesk Support API, Linear API
**AI Analysis**: Claude Sonnet 4 (Anthropic)

---

## 1. User Analysis Tool

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

**Automatic Daily Sync** (2:00-3:00 AM UTC via cron):
1. `sync-mixpanel-user-events-v2` - Event metrics (~2-5 min)
2. `sync-mixpanel-user-properties-v2` - User properties (~5-10 min)
3. `sync-mixpanel-engagement` - Granular engagement (~60-90s)
   - Auto-triggers pattern analysis functions

**Manual Triggers**:
- Event sequences analysis (via UI button)
- Ad-hoc data refresh

---

## 2. Creator Analysis Tool

Analyzes creator performance metrics and identifies top performers.

### Core Analyses

#### 2.1 Creator Insights
**Purpose**: Track creator engagement and revenue metrics

**Metrics tracked**:
- Engagement: profile views, PDP views, paywall views
- Revenue: subscriptions, subscription revenue, cancellations
- Trading: total copies, investment volume

#### 2.2 Subscription Price Analysis
**Purpose**: Analyze subscription metrics by price point

**What it tracks**: Subscriptions and paywall views at each price tier for price elasticity analysis

#### 2.3 Creator Enrichment
**Purpose**: Merge uploaded creator CSVs with Mixpanel metrics for correlation analysis

**Process**:
1. Upload 3 CSV files (Creator List, Deals, Public Creators)
2. Files merged using name/email matching
3. Enriched with Mixpanel user profiles and engagement data
4. Correlation analysis identifies predictive attributes

---

## 3. Business Model Analysis Tool

Configurable revenue projections based on user behavior and conversion metrics.

**Key Parameters**:
- Revenue rates (copy fees, subscription prices)
- User behavior (growth rate, churn, rebalance frequency)
- Conversion rates (auto-updated from pattern analysis)

**Auto-sync**: Conversion rates updated after pattern analysis completes

---

## 4. Support Feedback Analysis Tool

AI-powered analysis of support tickets to identify and prioritize product issues.

**Data Sources**:
- Zendesk support tickets
- Instabug bug reports (future)

**What it does**:
- Categorizes issues (Compliance, Money Movement, Trading, App Functionality, Feature Requests)
- Calculates priority scores based on category weight, frequency, and volume
- Links tickets to user profiles for segment analysis
- Provides top 10 issues with representative examples

**PII Protection**: All sensitive data redacted at ingestion (SSN, credit cards, phone numbers, etc.)

**Automation**: Runs weekly via cron (Sundays at 3:30 AM UTC)
**Cost**: ~$0.25 per weekly analysis (~$13/year)

## 5. Linear Integration Tool

Automatically maps user feedback to Linear issues for product roadmap prioritization.

**Data Sources**:
- Weekly support feedback analysis results
- Linear issues (synced via Linear API)

**What it does**:
- Matches top feedback themes to Linear issue titles using Claude AI
- Tracks mapping confidence scores
- Enables linking product priorities to customer pain points

**Automation**: Runs weekly after support analysis (Sundays at 4:10 AM UTC)

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

**Support Analysis** (3:30-4:00 AM UTC):
1. `sync-support-conversations` - Zendesk tickets
2. `analyze-support-feedback` - AI categorization

**Linear Integration** (4:00-4:10 AM UTC):
1. `sync-linear-issues` - Linear issues sync
2. `map-linear-to-feedback` - AI-powered feedback mapping

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

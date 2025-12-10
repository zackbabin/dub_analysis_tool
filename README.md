# dub Advanced Analytics

Comprehensive analytics platform for analyzing user behavior, creator performance, and customer experience for an investment social network. Combines real-time data from Mixpanel, Zendesk, and Linear with AI-powered analysis to identify conversion drivers, prioritize product issues, and optimize creator strategies.

## System Architecture

- **Frontend**: Static HTML/CSS/JS hosted on GitHub Pages
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **Data Sources**: Mixpanel Analytics API, Zendesk Support API, Linear API
- **AI Analysis**: Claude Opus 4.5 (Anthropic)

## Key Features

- **Summary Stats**: High-level marketing metrics and platform health indicators
- **Behavior Analysis**: User journey patterns, conversion drivers, and engagement thresholds
- **CX Analysis**: AI-categorized support feedback with Linear issue tracking
- **Premium Creator Analysis**: Creator performance metrics, retention analysis, and copy behavior patterns

---

## Summary Stats

High-level platform metrics for marketing and executive reporting.

### Data Sources

**Mixpanel Insights API**: Pre-aggregated marketing metrics from saved charts

### Sections

**Marketing Metrics**
- Objective: Display key platform health indicators (avg monthly copies, total investments, public portfolios)
- Manual fetch via "Fetch Marketing Data" button

**Demographic Breakdown**
- Objective: Visualize user distribution by income, net worth, and investing activity segments

**Persona Breakdown**
- Objective: Segment users by engagement and subscription status
- Four personas: Premium (≥1 subscription), Core (≥1 copy), Activation Targets (high engagement, no conversion), Non-activated (minimal engagement)

---

## Behavior Analysis

Identifies behavioral patterns and conversion drivers through statistical correlation analysis.

### Data Sources

**Mixpanel**:
- **Event Metrics**: 17 pre-aggregated behavioral metrics (copies, bank links, app sessions, tab views, creator/portfolio views, subscriptions)
- **User Properties**: 15 demographic and engagement properties (income, net worth, buying power, portfolios created/copied, deposits)
- **Engagement Events**: Granular user-portfolio-creator interactions (profile views, PDP views, copies, subscriptions)
- **Event Sequences**: "Viewed Portfolio Details", "Tapped Portfolio Card", "Viewed Creator Profile", "Tapped Creator Card" events

### Sections

**Copy Conversion Analysis**
- Objective: Display conversion rates and engagement thresholds for portfolio copying
- Shows average/median unique portfolios and creators viewed before first copy
- Compares converters vs. non-converters

**Portfolio Conversion Paths**
- Objective: Identify most common portfolio viewing sequences leading to first copy
- Three analysis types: top portfolios viewed, common combinations, sequential paths
- Includes both "Viewed Portfolio Details" and "Tapped Portfolio Card" events with category labels

**Creator Conversion Paths**
- Objective: Identify most common creator viewing sequences leading to first copy
- Three analysis types: top creators viewed, common combinations, sequential paths
- Includes both "Viewed Creator Profile" and "Tapped Creator Card" events with (C) suffix

**Hidden Gems Analysis**
- Objective: Identify high-engagement portfolios with low conversion rates
- Highlights optimization opportunities for improving portfolio discovery

**Top Behavioral Drivers**
- Objective: Identify variables with strongest statistical correlation to conversions (deposits, copies, subscriptions)
- Uses correlation coefficients and t-statistics across 17+ behavioral variables
- Separate analysis for each conversion type with tabbed interface

---

## CX Analysis

AI-powered customer experience analysis categorizing support feedback and mapping to Linear issues.

### Data Sources

- **Zendesk**: Last 30 days of support tickets
- **Linear API**: All issues from "dub 3.0" team
- **Claude Opus 4.5 (Anthropic)**: AI categorization and semantic matching

### Sections

**Top 10 Product Issues**
- Objective: Prioritize customer feedback by impact and severity using AI categorization
- **Powered by Claude Opus 4.5**: Analyzes ~300 conversations, categorizes into themes, ranks by composite priority score
- Priority formula combines category weight (money movement, trading, app functionality, feedback), percentage affected, and weekly volume
- For each issue: summary, weekly volume, representative examples, mapped Linear issues
- **PII Protection**: All sensitive data automatically redacted before AI analysis

---

## Premium Creator Analysis

Tracks premium creator performance, subscription retention, and copy behavior patterns.

### Data Sources

**Mixpanel**:
- Creator engagement metrics (profile views, PDP views, paywall views)
- Subscription events (new subscriptions, cancellations, revenue)
- Copy behavior (copies, liquidations, copy capital)

**Manual Uploads** (CSV):
- Portfolio performance metrics (returns, positions, inception dates)
- Portfolio stock holdings (ticker, quantity, position count)

### Sections

**Subscription Conversion Analysis**
- Objective: Identify viewing patterns before first subscription
- Shows top combinations and sequential paths leading to subscriptions

**Premium Creator Breakdown**
- Objective: Performance dashboard for each premium creator
- Metrics: engagement, revenue, trading activity, all-time returns
- Filterable by creator with sortable columns

**Subscription Price Distribution**
- Objective: Analyze subscription pricing across creators
- Shows distribution by price point and billing interval (monthly/annual)

**Premium Creator Retention**
- Objective: Track month-over-month subscription renewal rates
- Cohort-based retention analysis by creator

**Premium Creator Copy Affinity**
- Objective: Identify which creators are frequently copied together
- Shows top 5 co-copied creators (premium + regular) for each premium creator
- Reveals creator clusters and cross-promotion opportunities

**Premium Portfolio Assets**
- Objective: Display most common stocks across premium creator portfolios
- Shows top holdings by frequency and total position size


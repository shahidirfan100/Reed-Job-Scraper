# Reed Jobs Scraper

Extract comprehensive Reed.co.uk job listings into structured datasets you can use for hiring research, salary benchmarking, and market analysis. Collect rich, low-noise job records with detailed attributes like salary ranges, work patterns, taxonomy categories, employer references, and posting metadata. Built for fast runs, scheduled monitoring, and production-ready exports.

## Features

- **Rich Job Records** — Capture high-value job attributes beyond basic title, company, and location
- **Low-Noise Output** — Removes empty fields to keep datasets cleaner and easier to analyze
- **Automatic Pagination** — Continues across result pages until your target count is reached
- **Duplicate Protection** — Skips repeated jobs across pages and overlapping searches
- **Flexible Search Inputs** — Start from keyword/location filters or a direct search URL
- **Date Filtering Support** — Filter results by posting recency for fresher datasets
- **Proxy Ready** — Works with Apify Proxy configuration for reliable collection at scale

## Use Cases

### Recruitment Intelligence
Track active hiring trends by role, region, and employment type. Build repeatable snapshots to compare market demand week over week.

### Salary Benchmarking
Collect salary ranges and salary metadata to benchmark compensation by location, sector, and role family.

### Employer Targeting
Identify organizations currently hiring for specific job clusters and build prospect lists for outreach workflows.

### Labor Market Research
Create structured datasets for reporting on job volume, remote options, contract mix, and role-level taxonomy shifts.

### Candidate Product Features
Power job alerts, dashboards, and internal analytics tools with regularly refreshed job listing data.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Start from a specific Reed search URL. |
| `keyword` | String | No | — | Job keyword or role phrase (for example, `"data analyst"`). |
| `location` | String | No | — | Location filter (for example, `"London"`). |
| `posted_date` | String | No | `"anytime"` | Date filter: `"anytime"`, `"today"`, `"last3days"`, `"last7days"`, `"last14days"`. |
| `collectDetails` | Boolean | No | `true` | Optional enrichment toggle for detail-oriented runs. |
| `results_wanted` | Integer | No | `100` | Maximum number of jobs to collect. |
| `max_pages` | Integer | No | `50` | Safety cap on paginated result pages. |
| `proxyConfiguration` | Object | No | — | Proxy settings for stable high-volume runs. |

---

## Output Data

Each dataset item can include rich fields such as:

| Field | Type | Description |
|-------|------|-------------|
| `url` | String | Canonical Reed job URL |
| `jobId` | String | Reed job identifier |
| `title` | String | Job title |
| `company` | String | Employer name |
| `employerId` | String | Employer profile reference |
| `location` | String | Display location |
| `countyLocation` | String | County-level location when available |
| `salary` | String | Salary text |
| `salaryMin` | Number | Lower salary bound |
| `salaryMax` | Number | Upper salary bound |
| `salaryType` | String | Salary cadence/type metadata |
| `currency` | String | Salary currency |
| `datePosted` | String | Posting timestamp |
| `dateUpdated` | String | Last update timestamp |
| `validThrough` | String | Expiry timestamp |
| `employmentType` | String | Normalized type (Permanent, Contract, etc.) |
| `isFullTime` | Boolean | Full-time flag |
| `isPartTime` | Boolean | Part-time flag |
| `isEasyApply` | Boolean | Easy apply flag |
| `isFeatured` | Boolean | Featured listing marker |
| `remoteWorkingOption` | String | Remote/hybrid metadata when provided |
| `taxonomyLevel1` | String | Primary role taxonomy |
| `taxonomyLevel2` | String | Secondary role taxonomy |
| `description_text` | String | Job description text |
| `description_html` | String | Job description in paragraph HTML |
| `totalAvailableForSearch` | Number | Total jobs available for that query |
| `page` | Number | Source page number |
| `_fetchedAt` | String | Collection timestamp |

Additional source fields may also be included when available to maximize data coverage.

---

## Usage Examples

### Basic Search

```json
{
    "keyword": "software engineer",
    "location": "London",
    "results_wanted": 20
}
```

### Date-Filtered Monitoring

```json
{
    "keyword": "product manager",
    "location": "Manchester",
    "posted_date": "last7days",
    "results_wanted": 100,
    "max_pages": 20
}
```

### Direct URL Collection

```json
{
    "startUrl": "https://www.reed.co.uk/jobs/data-analyst-jobs-in-birmingham",
    "results_wanted": 50,
    "max_pages": 10
}
```

### Proxy-Enabled Run

```json
{
    "keyword": "nurse",
    "location": "Leeds",
    "results_wanted": 120,
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

---

## Sample Output

```json
{
    "jobId": "56641091",
    "jobTitle": "Regional Sales Manager",
    "salaryDescription": "£55,000 - £65,000",
    "salaryFrom": 55000,
    "salaryTo": 65000,
    "salaryType": "Annual",
    "displayLocationName": "Leeds",
    "remoteWorkingOption": "Hybrid",
    "isEasyApply": true,
    "taxonomyLevel1": "Sales",
    "taxonomyLevel2": "Medical Sales",
    "url": "https://www.reed.co.uk/jobs/regional-sales-manager/56641091",
    "title": "Regional Sales Manager",
    "company": "Evolve Selection Ltd",
    "location": "Leeds",
    "salary": "£55,000 - £65,000",
    "currency": "GBP",
    "datePosted": "2026-03-13T12:42:49.98",
    "employmentType": "Permanent",
    "description_text": "Evolve have partnered with a leading Ophthalmology organisation...",
    "page": 1,
    "totalAvailableForSearch": 1080,
    "_source": "reed.co.uk",
    "_fetchedAt": "2026-03-13T12:43:41.663Z"
}
```

---

## Tips for Best Results

### Start Small, Then Scale
- Begin with `results_wanted: 20` for quick validation
- Increase limits once output quality matches your needs

### Use Focused Queries
- Combine specific keywords with locations for cleaner datasets
- Prefer direct `startUrl` when you already have a refined Reed search

### Keep Runs Reliable
- Set `max_pages` based on expected result volume
- Use proxy configuration for larger, repeated runs

### Build Repeatable Monitoring
- Schedule daily or weekly runs for trend tracking
- Compare snapshots to detect hiring momentum changes

---

## Integrations

Connect your dataset with:

- **Google Sheets** — Fast sharing and tabular analysis
- **Airtable** — Searchable operational job database
- **Slack** — Alerting for new role patterns
- **Make** — Automated no-code workflows
- **Zapier** — Trigger downstream business actions
- **Webhooks** — Push results into custom systems

### Export Formats

- **JSON** — Developer-friendly structured output
- **CSV** — Spreadsheet workflows
- **Excel** — Reporting and stakeholder sharing
- **XML** — Legacy system integrations
- **JSONL** — Stream-friendly ingestion

---

## Frequently Asked Questions

### How many jobs can I collect in one run?
You can collect up to your configured `results_wanted` value, bounded by available listings and `max_pages`.

### Can I run without a keyword?
Yes. You can provide a `startUrl` directly, or run broad collection with location/date constraints.

### Why do some fields vary between records?
Job listings are publisher-dependent, so available fields differ by employer and listing type.

### Does the actor avoid duplicates?
Yes. Duplicate jobs are skipped using stable identifiers and URL fallback matching.

### Can I schedule this actor?
Yes. Use Apify schedules for continuous market monitoring and reporting pipelines.

### Is this suitable for salary analysis?
Yes. The output includes salary text, bounds, and related metadata when available.

---

## Support

For issues or feature requests, use Apify Console support channels.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is intended for legitimate data collection and analytics use. You are responsible for complying with applicable laws, platform terms, and data usage policies.

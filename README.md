# Reed.co.uk Job Scraper

Extract comprehensive job listings from Reed.co.uk — the UK's largest job board — with ease. Collect job titles, companies, salaries, locations, employment types, and full descriptions at scale. Perfect for recruitment research, salary benchmarking, market intelligence, and workforce analysis.

## Features

- **Keyword & Location Search** — Target specific roles and cities or provide a custom Reed search URL directly
- **Full Job Detail Extraction** — Optionally visit each job page for complete descriptions, salary details, and metadata
- **Automatic Pagination** — Traverses all result pages automatically to reach your desired job count
- **Date Filtering** — Filter by posting date: today, last 3 days, last 7 days, or last 14 days
- **Configurable Result Limits** — Set a maximum number of jobs or pages for controlled, efficient runs
- **Proxy Support** — Works seamlessly with Apify Proxy for reliable, uninterrupted data collection
- **Structured Dataset Output** — Clean, consistent JSON records ready for export and analysis

## Use Cases

### Recruitment & Talent Acquisition
Find and monitor open positions across the UK job market. Track hiring trends by industry, location, and role to source candidates faster and stay ahead of competitor hiring activity.

### Salary Benchmarking
Collect salary data across hundreds of job listings to benchmark compensation for specific roles and locations. Build accurate, up-to-date salary reports for HR teams and finance departments.

### Job Market Research
Analyze which skills, qualifications, and job titles are in highest demand. Understand market trends over time and identify growth areas within sectors like technology, finance, healthcare, and more.

### Lead Generation for Recruitment Agencies
Automatically gather lists of companies that are actively hiring. Use employer details and open positions as qualified leads for outreach and placement services.

### Academic & Economic Research
Build large-scale datasets of UK employment data for academic study, labour market analysis, or economic forecasting — with consistent, structured records across thousands of postings.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | A specific Reed.co.uk search URL to start from. Overrides keyword/location if provided. |
| `keyword` | String | No | — | Job title or keywords to search for (e.g., `"software developer"`). |
| `location` | String | No | — | Geographic location to filter jobs (e.g., `"London"`, `"Manchester"`). |
| `posted_date` | String | No | `"anytime"` | Filter by posting recency: `"anytime"`, `"today"`, `"last3days"`, `"last7days"`, `"last14days"`. |
| `collectDetails` | Boolean | No | `true` | Visit individual job pages to collect full descriptions and additional metadata. |
| `results_wanted` | Integer | No | `100` | Maximum number of job listings to collect. Leave empty to collect all available. |
| `max_pages` | Integer | No | `20` | Maximum number of search result pages to visit — a safety cap for large runs. |
| `proxyConfiguration` | Object | No | — | Apify Proxy settings for reliable data collection. |

---

## Output Data

Each item saved to the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `url` | String | Direct link to the job posting on Reed.co.uk |
| `title` | String | Job title |
| `company` | String | Name of the hiring company |
| `location` | String | Job location (city, region) |
| `salary` | String | Salary or pay range as displayed |
| `datePosted` | String | Date the job was posted (ISO format) |
| `employmentType` | String | Employment type (e.g., `"Full-time"`, `"Part-time"`, `"Contract"`) |
| `validThrough` | String | Expiry date of the job listing (ISO format) |
| `postalCode` | String | Postal code of the job location |
| `description_html` | String | Full job description in HTML format (requires `collectDetails`) |
| `description_text` | String | Plain text version of the job description (requires `collectDetails`) |

---

## Usage Examples

### Basic Job Search

Search for Python developer roles in London:

```json
{
    "keyword": "python developer",
    "location": "London",
    "results_wanted": 50
}
```

### Filter by Date Posted

Find nursing jobs posted in the last 3 days across the UK:

```json
{
    "keyword": "nurse",
    "posted_date": "last3days",
    "results_wanted": 100,
    "collectDetails": true
}
```

### Scrape From a Custom Reed URL

Use a specific Reed.co.uk search URL to start from (e.g., with advanced filters already applied):

```json
{
    "startUrl": "https://www.reed.co.uk/jobs/data-analyst-jobs-in-manchester",
    "results_wanted": 200,
    "collectDetails": true
}
```

### Large-Scale Collection with Proxy

Collect all available software engineering jobs with proxy enabled:

```json
{
    "keyword": "software engineer",
    "location": "United Kingdom",
    "posted_date": "last7days",
    "results_wanted": 500,
    "max_pages": 50,
    "collectDetails": true,
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
    "url": "https://www.reed.co.uk/jobs/software-engineer/12345678",
    "title": "Senior Software Engineer",
    "company": "Tech Solutions Ltd",
    "location": "London",
    "salary": "£65,000 - £80,000 per annum",
    "datePosted": "2024-06-10T00:00:00.000Z",
    "employmentType": "Full-time",
    "validThrough": "2024-07-10T00:00:00.000Z",
    "postalCode": "EC1A 1BB",
    "description_html": "<p>We are looking for a Senior Software Engineer to join our growing team...</p>",
    "description_text": "We are looking for a Senior Software Engineer to join our growing team..."
}
```

---

## Tips for Best Results

### Choosing Your Start Method
- Use **keyword + location** for flexible, broad searches — great for market research
- Use **startUrl** when you need an exact Reed.co.uk search with custom filters already applied
- Avoid combining `startUrl` with keyword/location — the URL takes priority

### Optimise Your Run Size
- Start with `results_wanted: 20–50` to test your configuration before scaling up
- Increase `max_pages` proportionally — each page typically returns 25 results
- Disable `collectDetails` for faster, lighter runs when only basic listing data is needed

### Getting Full Job Descriptions
- Enable `collectDetails: true` to fetch full descriptions, salary breakdowns, and extra metadata
- Runs with detail collection are slower — plan your result count accordingly
- Use a proxy for runs collecting more than 100 detailed job pages

### Proxy Configuration
For large-scale or high-frequency runs, residential proxies are recommended:

```json
{
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

---

## Integrations

Connect your Reed job data with the tools you already use:

- **Google Sheets** — Export directly for collaborative analysis and filtering
- **Airtable** — Build a searchable jobs database for recruitment teams
- **Slack** — Receive notifications when new relevant jobs appear
- **Make (Integromat)** — Trigger automated workflows from newly scraped data
- **Zapier** — Push job data to CRMs, email tools, or internal systems
- **Webhooks** — Send results to any custom endpoint in real time

### Export Formats

Download your dataset in multiple formats from the Apify platform:

- **JSON** — For developers and API integrations
- **CSV** — For spreadsheet tools like Excel or Google Sheets
- **Excel (.xlsx)** — For business reporting
- **XML** — For system-to-system integrations
- **JSONL** — For large datasets and streaming ingestion

---

## Frequently Asked Questions

### How many jobs can I collect?
You can collect as many jobs as are available on Reed.co.uk for a given search. Leave `results_wanted` empty to collect all results, or set a number to cap the run.

### Do I need a Reed account?
No account is required. The scraper collects publicly available job listings without authentication.

### Can I search multiple keywords or locations?
Currently one search configuration is supported per run. To collect jobs for multiple keywords or locations, run the actor multiple times with different inputs or use the Apify API to trigger multiple runs.

### What does `collectDetails` do?
When enabled, the scraper visits each individual job page to retrieve the full job description, detailed salary info, postal code, and expiry date. Disabling it makes runs faster but returns less data per listing.

### What is `startUrl` used for?
You can paste any Reed.co.uk search results URL directly — for example, after using Reed's advanced filter UI. The scraper will start from that URL and paginate through all results.

### Will the scraper miss jobs if I set `max_pages` too low?
Yes. Each page contains approximately 25 results. If you want 500 jobs, set `max_pages` to at least 20. The `results_wanted` limit stops collection once reached, even if more pages remain.

### Is data available in real time?
The scraper fetches data at the time of the run. Scheduling the actor to run daily or weekly ensures your dataset stays up to date.

### Can I use this for salary analysis?
Yes. Salary data is extracted from each listing (and more accurately from detail pages). You can export to CSV or connect to a BI tool for aggregation and analysis.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)
- [Apify Proxy](https://docs.apify.com/proxy)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with Reed.co.uk's terms of service and applicable laws. Use collected data responsibly, respect rate limits, and do not use this tool for any unlawful purpose.
## What does Reed Jobs Scraper do?

Reed Jobs Scraper collects public job listings from Reed.co.uk and saves them as structured records for recruitment research, salary benchmarking, hiring intelligence, and job-market analysis. Enter a keyword and optional location, choose a posting-date filter, or provide a public Reed search URL. The Actor paginates through matching results and can include job descriptions when they are available.

Each record can include the job title, employer, location, salary range, currency, employment type, remote-working information, role taxonomy, posting dates, description text, and the direct job URL. Export the dataset as JSON, CSV, Excel, XML, or JSONL, or connect it to an automated workflow in Apify.

## Why use Reed Jobs Scraper?

- **Hiring market research** - Compare job volume, role categories, locations, and employment types across repeatable searches.
- **Salary benchmarking** - Analyze published salary text, minimum and maximum salary values, currency, and salary type by role or region.
- **Employer targeting** - Find companies actively hiring for specific skills, job families, or locations.
- **Fresh job monitoring** - Use posting-date filters and scheduled runs to track newly listed roles.
- **Clean datasets** - Empty values are removed, and repeated jobs are skipped when the same job appears across pages or overlapping searches.
- **Workflow-ready exports** - Download results or send them to Google Sheets, Airtable, webhooks, Make, Zapier, or your own application through the Apify API.

## What data can you extract from Reed.co.uk?

| Field | Type | Description |
|-------|------|-------------|
| `url` | String | Canonical Reed job listing URL. |
| `jobId` | String | Reed job identifier. |
| `title` | String | Job title. |
| `company` | String | Employer or recruiting organization. |
| `employerId` | String | Employer profile reference when published. |
| `employerUrl` | String | Employer profile or related Reed URL when available. |
| `logoUrl` | String | Employer logo URL when available. |
| `location` | String | Display location for the job. |
| `countyLocation` | String | County-level location when published. |
| `salary` | String | Salary text as displayed by Reed. |
| `salaryMin` | Number | Lower salary bound when published. |
| `salaryMax` | Number | Upper salary bound when published. |
| `currency` | String | Salary currency, normally `GBP` for Reed UK listings. |
| `salaryType` | String | Salary cadence or type metadata. |
| `datePosted` | String | Date or timestamp when the job was posted. |
| `dateUpdated` | String | Last update timestamp when published. |
| `validThrough` | String | Listing expiry timestamp when published. |
| `employmentType` | String | Normalized employment type, such as Permanent or Contract. |
| `isFullTime` | Boolean | Whether the listing identifies the role as full time. |
| `isPartTime` | Boolean | Whether the listing identifies the role as part time. |
| `isEasyApply` | Boolean | Whether Reed marks the role as easy to apply for. |
| `isFeatured` | Boolean | Whether the listing is marked as featured. |
| `remoteWorkingOption` | String | Remote, hybrid, or other workplace information when available. |
| `taxonomyLevel1` | String | Primary Reed role category. |
| `taxonomyLevel2` | String | Secondary Reed role category or specialism. |
| `description_text` | String | Plain-text job description. |
| `description_html` | String | Job description formatted as paragraph HTML. |
| `page` | Number | Reed result page where the listing was found. |
| `totalAvailableForSearch` | Number | Total result count reported for the search. |
| `queryKeyword` | String | Keyword used for the search, when applicable. |
| `queryLocation` | String | Location used for the search, when applicable. |
| `postedDateFilter` | String | Posting-date filter used for the run. |
| `_source` | String | Source label, returned as `reed.co.uk`. |
| `_fetchedAt` | String | UTC timestamp for collection. |

Additional non-empty Reed fields may be included when the source publishes them.

## How to scrape Reed jobs

1. Open Reed Jobs Scraper in Apify Console.
2. Enter a job keyword such as `software engineer`, and optionally add a location such as `London`.
3. Select a posting-date filter and set the maximum number of jobs and pages.
4. Alternatively, paste a public Reed search URL into `startUrl`.
5. Run the Actor, review the dataset preview, and download or connect the results.

Keyword and location searches are the simplest option. Use `startUrl` when you have already configured a Reed search with specific filters.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | None | Public Reed.co.uk search URL. When supplied, the Actor starts from this URL instead of building a search from `keyword` and `location`. |
| `keyword` | String | No | `administrative assistant` | Job title, skill, or search phrase. |
| `location` | String | No | None | Optional city, region, or other Reed location filter. |
| `posted_date` | String | No | `anytime` | Posting-date filter: `anytime`, `today`, `last3days`, `last7days`, or `last14days`. |
| `results_wanted` | Integer | No | `20` | Maximum number of jobs to save. |
| `max_pages` | Integer | No | `20` | Safety cap on the number of Reed result pages to process. |


## Output Data

The Actor writes one dataset item per unique Reed job. Fields that Reed does not publish for a listing are omitted rather than returned as empty values.

| Field | Type | Description |
|-------|------|-------------|
| `jobId` | String | Stable Reed identifier used for duplicate protection. |
| `title` | String | Job title. |
| `company` | String | Employer name. |
| `location` | String | Display location. |
| `salary` | String | Human-readable salary. |
| `salaryMin` | Number | Minimum salary, when available. |
| `salaryMax` | Number | Maximum salary, when available. |
| `currency` | String | Salary currency. |
| `employmentType` | String | Normalized contract or employment type. |
| `datePosted` | String | Date the job was posted. |
| `remoteWorkingOption` | String | Remote or hybrid information. |
| `taxonomyLevel1` | String | Main role category. |
| `taxonomyLevel2` | String | Role specialism. |
| `description_text` | String | Plain-text description. |
| `description_html` | String | HTML description. |
| `url` | String | Direct Reed job URL. |
| `page` | Number | Result page number. |
| `_fetchedAt` | String | Collection timestamp in UTC. |

## Usage Examples

### Basic keyword search

Collect 20 software engineering jobs in London.

```json
{
  "keyword": "software engineer",
  "location": "London",
  "results_wanted": 20
}
```

### Date-filtered hiring research

Collect recently posted product manager roles in Manchester across up to 20 pages.

```json
{
  "keyword": "product manager",
  "location": "Manchester",
  "posted_date": "last7days",
  "results_wanted": 100,
  "max_pages": 20
}
```

### Collection from a prepared Reed URL

Reuse a public Reed search URL when its search filters are already configured.

```json
{
  "startUrl": "https://www.reed.co.uk/jobs/data-analyst-jobs-in-birmingham",
  "results_wanted": 50,
  "max_pages": 10
}
```


## Sample Output

The following example shows one dataset item. Optional fields may be omitted when Reed does not publish them for a particular listing.

```json
{
  "url": "https://www.reed.co.uk/jobs/regional-sales-manager/56641091",
  "jobId": "56641091",
  "title": "Regional Sales Manager",
  "company": "Evolve Selection Ltd",
  "employerId": "evolve-selection-ltd",
  "employerUrl": "https://www.reed.co.uk/company/evolve-selection-ltd",
  "location": "Leeds",
  "salary": "£55,000 - £65,000",
  "salaryMin": 55000,
  "salaryMax": 65000,
  "currency": "GBP",
  "salaryType": "Annual",
  "datePosted": "2026-03-13T12:42:49.98",
  "employmentType": "Permanent",
  "isFullTime": true,
  "isEasyApply": true,
  "isFeatured": false,
  "remoteWorkingOption": "Hybrid",
  "taxonomyLevel1": "Sales",
  "taxonomyLevel2": "Medical Sales",
  "description_text": "Evolve have partnered with a leading Ophthalmology organisation...",
  "page": 1,
  "totalAvailableForSearch": 1080,
  "queryKeyword": "regional sales manager",
  "queryLocation": "Leeds",
  "postedDateFilter": "anytime",
  "_source": "reed.co.uk",
  "_fetchedAt": "2026-03-13T12:43:41.663Z"
}
```

## Tips for Best Results

- **Start with a small limit** - Run 20 results first and inspect the dataset before scaling up.
- **Use focused searches** - Combine a specific job title or skill with a location for a more targeted dataset.
- **Use `startUrl` for prepared filters** - A public Reed search URL can preserve filters configured on the source website.
- **Set a sensible page cap** - Increase `max_pages` for broad searches, but keep it aligned with the result limit.
- **Expect source-dependent fields** - Salary, employer references, descriptions, and workplace details are only available when Reed publishes them.
- **Schedule repeat runs** - Daily or weekly schedules can help monitor hiring demand and newly posted roles.
- **Check the dataset preview** - Confirm the query and output quality before creating a larger recurring run.

## Integrations and Exports

- **Google Sheets** - Review and share job records in a spreadsheet.
- **Airtable** - Maintain a searchable hiring or employer database.
- **Webhooks** - Notify another service when a run finishes.
- **Make and Zapier** - Send new listings to alerts, dashboards, or internal workflows.
- **Apify API** - Start runs and read dataset items from your own application.
- **JSON, CSV, Excel, XML, and JSONL** - Choose an export format for analysis, reporting, or data pipelines.

## Frequently Asked Questions

### Can I search Reed jobs by keyword and location?

Yes. Set `keyword` and optionally add `location` to build a Reed job search. You can also provide a prepared public search URL through `startUrl`.

### Can I filter Reed jobs by posting date?

Yes. Use `posted_date` with `anytime`, `today`, `last3days`, `last7days`, or `last14days`.

### How many jobs can I collect in one run?

Set `results_wanted` to the maximum number of records you need. The final count also depends on matching Reed listings and the `max_pages` limit.

### Why are some output fields missing?

Reed does not publish every field for every job. Missing salary, employer, description, or workplace values usually reflect the source listing rather than a failed run.

### Does the Actor remove duplicate jobs?

Yes. The Actor uses the Reed job ID or listing URL to avoid saving the same job more than once across result pages.

### Can I schedule recurring Reed job searches?

Yes. Create an Apify schedule to run the same keyword, location, URL, and date filter hourly, daily, weekly, or on a custom interval.

### Is collecting Reed job data legal?

Collecting public data may be subject to applicable laws, privacy requirements, and Reed terms. You are responsible for using the Actor lawfully and handling job data responsibly.

## Related Actors

- [BuiltIn Jobs Scraper](https://apify.com/shahidirfan/builtin-jobs-scraper) - Collect technology and startup job listings with salary and workplace information.
- [APEC Jobs Scraper](https://apify.com/shahidirfan/apec-jobs-scraper) - Gather French executive and professional job listings for European hiring research.
- [USA Jobs Scraper](https://apify.com/shahidirfan/usa-jobs-scraper) - Collect job opportunities across the United States employment market.
- [Seek Job Scraper](https://apify.com/shahidirfan/seek-job-scraper) - Extract job listings from Seek for Australia-focused hiring and market analysis.

## Support

For issues or feature requests, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is intended for legitimate collection and analysis of publicly available Reed job information. Do not use collected data for unlawful discrimination, harassment, spam, or other abusive activity. Follow Reed's terms and all applicable laws and privacy rules.

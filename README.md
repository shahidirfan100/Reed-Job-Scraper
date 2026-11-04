# Reed Jobs Scraper

Reed Jobs Scraper collects public job listings from Reed.co.uk and saves each job as one structured record. Use it to track hiring demand, compare salaries, or build a dataset of UK roles for research.

Each record can include the job title, employer, location, postcode, salary range, contract type, working pattern, skills, role category, posting dates, full description, and the direct Reed URL.

## What you can collect

- Job title, employer name, employer profile link, and employer logo
- Town, county, region, country, and postcode
- Salary text, raw minimum and maximum, pay period, and annualised values
- Contract type, full-time and part-time flags, and temporary or permanent status
- Remote, hybrid, or on-site working information
- Skills, sector, role taxonomy, and breadcrumb categories
- Full job description as plain text and as paragraph HTML when Reed returns one
- Posting date, update date, and expiry date
- Result page and total result count for the search

## Why use this Actor

Recruitment teams can follow which employers are hiring in a region and which skills appear most often. Analysts can compare salary ranges for the same role across cities. Job seekers can monitor new postings with a date filter. Researchers can export a repeatable dataset instead of copying listings by hand.

Searches are repeatable. The same keyword, location, and date filter produce a fresh dataset on each run, and duplicate jobs are skipped within a run.

## How to use it

1. Open the Actor in Apify Console.
2. Enter a keyword such as `software engineer`.
3. Optionally add a location such as `London`.
4. Choose a posting-date window and set the maximum number of jobs.
5. Run the Actor and review the dataset.
6. Download the results or connect the dataset to another tool.

You can also paste a public Reed search URL or a Reed job URL into `startUrl`. When `startUrl` is set, the Actor uses that URL and ignores the keyword and location fields.

To search by location alone, clear the keyword field. The keyword field has a default value so a run with no input still works. If you leave the default in place and add a location, the Actor searches for that keyword in that location.

## Input parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `startUrl` | String | No | None | Public Reed search URL or Reed job URL. Takes priority over keyword and location. |
| `keyword` | String | No | `administrative assistant` | Job title, skill, or search phrase. Clear this field to search by location alone. |
| `location` | String | No | None | UK town, city, or region. |
| `posted_date` | String | No | `anytime` | One of `anytime`, `today`, `last3days`, `last7days`, or `last14days`. |
| `results_wanted` | Integer | No | `20` | Maximum number of jobs to save. Reed exposes at most 10,000 results for one search. |
| `max_pages` | Integer | No | `20` | Safety cap on result pages. Each page holds up to 100 jobs. |
| `proxyConfiguration` | Object | No | Empty | Optional proxy settings for larger runs. |

## Output fields

### Job and employer

| Field | Type | Description |
|---|---|---|
| `url` | String | Direct Reed job URL. |
| `jobId` | String | Reed job identifier. |
| `title` | String | Job title. |
| `company` | String | Employer or recruiting organization. |
| `employerId` | String | Reed employer profile reference. |
| `employerUrl` | String | Reed employer listing URL. |
| `companyProfileUrl` | String | Reed company profile URL when published. |
| `logoUrl` | String | Employer logo URL when published. |

### Location

| Field | Type | Description |
|---|---|---|
| `location` | String | Display location for the job. |
| `town` | String | Town name when published. |
| `countyLocation` | String | County name when published. |
| `region` | String | Region name when published. |
| `country` | String | Country name when published. |
| `countryCode` | String | Two-letter country code. |
| `postcode` | String | Postcode or postcode district when published. |
| `isRemote` | Boolean | Whether Reed marks the job as remote. |
| `remoteWorkingOption` | String | `Remote`, `Hybrid`, or `On-site`. |

### Salary

| Field | Type | Description |
|---|---|---|
| `salary` | String | Salary text as shown by Reed. |
| `salaryMin` | Number | Lower salary bound in the published pay period. |
| `salaryMax` | Number | Upper salary bound in the published pay period. |
| `salaryPeriod` | String | Pay period, such as `per annum` or `per hour`. |
| `salaryAnnualMin` | Number | Annualised lower bound when Reed publishes one. |
| `salaryAnnualMax` | Number | Annualised upper bound when Reed publishes one. |
| `isSalaryNegotiable` | Boolean | Whether the salary is marked negotiable. |
| `currency` | String | Salary currency, normally `GBP`. |
| `salaryType` | String | Pay period text from Reed. |

### Contract and dates

| Field | Type | Description |
|---|---|---|
| `employmentType` | String | Contract type, such as `Permanent`, `Contract`, or `Temporary`. |
| `isFullTime` | Boolean | Full-time flag. |
| `isPartTime` | Boolean | Part-time flag. |
| `isPermanent` | Boolean | Permanent role flag. |
| `isContract` | Boolean | Contract role flag. |
| `isTemporary` | Boolean | Temporary role flag. |
| `isAgency` | Boolean | Posted by a recruitment agency. |
| `isEmployer` | Boolean | Posted by the employer. |
| `isReed` | Boolean | Posted by Reed. |
| `isGraduate` | Boolean | Graduate role flag. |
| `isEasyApply` | Boolean | Easy Apply flag. |
| `isFeatured` | Boolean | Featured listing flag. |
| `isPromoted` | Boolean | Promoted listing flag. |
| `isPriority` | Boolean | Priority listing flag. |
| `isTopJob` | Boolean | Top job flag. |
| `isTrainingJob` | Boolean | Training job flag. |
| `requiresUkEligibility` | Boolean | Whether the job requires UK work eligibility. |
| `eligibilityRequirement` | String | Eligibility text from Reed when published. |
| `datePosted` | String | Date or timestamp when the job was posted. |
| `dateUpdated` | String | Last update timestamp. |
| `validThrough` | String | Listing expiry timestamp. |

### Classification

| Field | Type | Description |
|---|---|---|
| `skills` | Array | Skill names attached to the job. |
| `sector` | String | Reed sector name. |
| `sectorId` | Number | Reed sector identifier. |
| `sectorParent` | String | Parent sector name. |
| `taxonomy` | String | Full Reed taxonomy path. |
| `taxonomyLevel1` | String | Primary role category. |
| `taxonomyLevel2` | String | Secondary role category or specialism. |
| `breadcrumbs` | Array | Category breadcrumb names. |

### Description and run metadata

| Field | Type | Description |
|---|---|---|
| `description_text` | String | Plain-text job description. |
| `description_html` | String | Job description as paragraph HTML. |
| `page` | Number | Result page where the job was found. |
| `totalAvailableForSearch` | Number | Total result count reported for the search. |
| `queryKeyword` | String | Keyword used for the search. |
| `queryLocation` | String | Location used for the search. |
| `postedDateFilter` | String | Posting-date filter used for the run. |
| `_source` | String | Source label, `reed.co.uk`. |
| `_fetchedAt` | String | UTC timestamp for collection. |

Reed does not publish every field for every job. Fields with no value are omitted from the record.

## Usage examples

### Keyword and location

```json
{
  "keyword": "software engineer",
  "location": "London",
  "results_wanted": 100
}
```

### Recent roles in a city

```json
{
  "keyword": "data analyst",
  "location": "Manchester",
  "posted_date": "last7days",
  "results_wanted": 50,
  "max_pages": 2
}
```

### Location-only search

Clear the keyword field and set a location.

```json
{
  "keyword": "",
  "location": "Birmingham",
  "results_wanted": 100
}
```

### Start from a prepared Reed search

```json
{
  "startUrl": "https://www.reed.co.uk/jobs/product-manager-jobs-in-leeds?datecreatedoffset=lastweek",
  "results_wanted": 50,
  "max_pages": 2
}
```

### Collect one job

```json
{
  "startUrl": "https://www.reed.co.uk/jobs/administrative-assistant/57470553"
}
```

Replace the job URL with a live Reed listing. If the job has expired, the Actor skips it and reports that the job is no longer available.

## Sample output

```json
{
  "url": "https://www.reed.co.uk/jobs/administrative-assistant/57470553",
  "jobId": "57470553",
  "title": "Administrative Assistant",
  "company": "GXO Logistics",
  "employerId": "4259",
  "employerUrl": "https://www.reed.co.uk/jobs/xpo-logistics/p4259",
  "companyProfileUrl": "https://www.reed.co.uk/company-profile/GXO-Logistics-61553",
  "logoUrl": "https://resources.reed.co.uk/profileimages/logos/thumbs/Logo_4259.png",
  "location": "Barrow-in-Furness",
  "town": "Barrow-in-Furness",
  "countyLocation": "Cumbria",
  "region": "North West England",
  "country": "United Kingdom",
  "countryCode": "GB",
  "postcode": "LA14",
  "isRemote": false,
  "salary": "£ 32,001 per annum",
  "salaryMin": 32000.52,
  "salaryMax": 32000.52,
  "salaryPeriod": "per annum",
  "salaryAnnualMin": 32000.52,
  "salaryAnnualMax": 32000.52,
  "isSalaryNegotiable": false,
  "currency": "GBP",
  "salaryType": "per annum",
  "datePosted": "2026-10-19T06:31:06.76",
  "dateUpdated": "2026-10-31T06:32:17.043",
  "validThrough": "2026-11-30T06:31:07.05",
  "employmentType": "Permanent",
  "isFullTime": true,
  "isPartTime": true,
  "isPermanent": true,
  "isContract": false,
  "isTemporary": false,
  "isAgency": false,
  "isEmployer": true,
  "isReed": false,
  "isGraduate": false,
  "isEasyApply": false,
  "isFeatured": true,
  "isPromoted": true,
  "isTrainingJob": false,
  "requiresUkEligibility": true,
  "eligibilityRequirement": "requiresEligibility",
  "remoteWorkingOption": "On-site",
  "skills": [
    "Administrative Roles (Administration)",
    "Attention to Detail (Attentions)",
    "Communication Skills (Key)",
    "Coordination Skills",
    "Customer Service",
    "Microsoft Excel",
    "Microsoft Office (Entry)",
    "Microsoft Word & Excel",
    "Self-Motivation",
    "Teamwork (Teams)"
  ],
  "sector": "Warehouse Supervisor",
  "sectorId": 931,
  "sectorParent": "Transport & Logistics",
  "taxonomy": "Occupation/KD: Logistics And Transport/Administrator/Administrator Assistant",
  "taxonomyLevel1": "Administrator",
  "taxonomyLevel2": "Administrator Assistant",
  "breadcrumbs": [
    "Logistics And Transport",
    "Administrator",
    "Administrator Assistant"
  ],
  "description_text": "Here at GXO, we are recruiting multiple Administrators to join our team in Barrow. You will be first point of contact to meet and greet all collecting and delivery HGV drivers.",
  "description_html": "<p>Here at GXO, we are recruiting multiple Administrators to join our team in Barrow.</p>",
  "page": 1,
  "totalAvailableForSearch": 3225,
  "queryKeyword": "administrative assistant",
  "postedDateFilter": "anytime",
  "_source": "reed.co.uk",
  "_fetchedAt": "2026-11-04T15:14:55.000Z"
}
```

The sample is trimmed for length. Skill lists and descriptions vary by job.

## Tips

- Start with 20 results to check the query, then raise the limit.
- Use `max_pages` as a cost control. One page can return up to 100 jobs.
- Use a date filter for recurring monitoring runs.
- Clear the keyword field when you want a location-only search.
- Use `startUrl` when Reed's own filters already describe the search you need.
- Expect some fields to be empty. Reed does not publish salary, postcode, or skills for every listing.
- Schedule daily or weekly runs to follow new postings.
- Add a proxy for large runs if your connection sees rate limits.

## Integrations

- Google Sheets for shared review
- Airtable for a searchable job database
- Webhooks for run notifications
- Make or Zapier for downstream workflows
- The Apify API for starting runs and reading datasets
- JSON, CSV, Excel, XML, and JSONL exports

## FAQ

### Can I search by keyword and location?

Yes. Set `keyword` and `location`. The Actor builds the matching Reed search URL for you.

### Can I search by location only?

Yes. Clear the keyword field and set `location`. The keyword field has a default value for no-input runs, so it must be cleared before a location-only search.

### Can I filter jobs by posting date?

Yes. Set `posted_date` to `today`, `last3days`, `last7days`, or `last14days`.

### How many jobs can one run collect?

Reed exposes up to 10,000 results for one search. `results_wanted` caps the dataset, and `max_pages` caps the number of pages read.

### Why are some fields empty?

Reed does not publish every field for every job. Missing salary, postcode, skills, or description values usually reflect the source listing.

### Does the Actor remove duplicate jobs?

Yes. It uses the Reed job ID or job URL to skip duplicates within a run.

### Does it collect full descriptions?

Yes. It reads the full description for each job when Reed returns one. If the description source is unavailable, it keeps the search result snippet.

### Can I run it on a schedule?

Yes. Create an Apify schedule with the same input to collect new postings hourly, daily, or weekly.

### Can I use a proxy?

Yes. Add proxy settings in `proxyConfiguration`. Leave it empty for a direct connection.

### Is collecting Reed job data legal?

Collecting public data can be subject to laws, privacy rules, and Reed's terms. You are responsible for using the Actor lawfully and handling job data responsibly.

## Related Actors

- [BuiltIn Jobs Scraper](https://apify.com/shahidirfan/builtin-jobs-scraper) for technology and startup roles
- [APEC Jobs Scraper](https://apify.com/shahidirfan/apec-jobs-scraper) for French executive and professional roles
- [USA Jobs Scraper](https://apify.com/shahidirfan/usa-jobs-scraper) for United States public sector roles
- [Seek Job Scraper](https://apify.com/shahidirfan/seek-job-scraper) for Australian job listings

## Support

For issues or feature requests, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal notice

This Actor is intended for legitimate collection and analysis of publicly available Reed job information. Do not use collected data for unlawful discrimination, harassment, spam, or other abusive activity. Follow Reed's terms and all applicable laws and privacy rules.

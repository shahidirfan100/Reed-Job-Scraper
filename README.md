# Reed.co.uk Jobs Scraper

## Description

This Apify actor efficiently scrapes job listings from Reed.co.uk, providing comprehensive data on available positions. It automates the collection of job details to help with market research, recruitment, or data analysis.

## Features

- **Comprehensive Scraping**: Extracts key job information such as title, company, location, salary, and descriptions.
- **Pagination Support**: Automatically handles multiple pages of search results.
- **Detailed Extraction**: Optionally collects full job descriptions and additional metadata.
- **Proxy Integration**: Compatible with residential proxies for reliable data collection.
- **Dataset Output**: Saves structured data for easy export and analysis.

## Input

The actor accepts the following input parameters to customize the scraping process:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `keyword` | String | No | Job title or keywords to search for (e.g., "software engineer"). |
| `location` | String | No | Geographic location to filter jobs (e.g., "London"). |
| `posted_date` | String | No | Filter by posting date (options: "today", "last3days", "last7days", "last14days"). |
| `startUrl` | String | No | Specific Reed.co.uk search URL to begin scraping from. |
| `results_wanted` | Number | No | Maximum number of jobs to collect (default: unlimited). |
| `max_pages` | Number | No | Maximum pages to scrape (safety limit). |
| `collectDetails` | Boolean | No | Enable to visit job detail pages for full descriptions (default: false). |
| `cookies` | Object | No | Custom cookies for requests to bypass restrictions. |
| `proxyConfiguration` | Object | No | Proxy settings for enhanced scraping reliability. |

## Output

The actor produces a dataset of job listings in JSON format, with each item containing:

| Field | Type | Description |
|-------|------|-------------|
| `url` | String | Direct link to the job posting. |
| `title` | String | Job title. |
| `company` | String | Hiring company name. |
| `location` | String | Job location. |
| `salary` | String | Salary details. |
| `datePosted` | String | Posting date in ISO format. |
| `employmentType` | String | Employment type (e.g., "Full-time", "Part-time"). |
| `validThrough` | String | Expiration date of the posting. |
| `postalCode` | String | Postal code of the location. |
| `description_html` | String | Full job description in HTML. |
| `description_text` | String | Plain text version of the description. |

## Usage

### Basic Usage

To scrape jobs for "data analyst" positions in "Manchester":

1. Set `keyword` to "data analyst".
2. Set `location` to "Manchester".
3. Run the actor.

### Advanced Usage

For detailed descriptions and a limit of 100 jobs:

1. Set `keyword` to your desired term.
2. Set `results_wanted` to 100.
3. Enable `collectDetails`.
4. Configure `proxyConfiguration` for proxies.

### Example Input JSON

```json
{
  "keyword": "software developer",
  "location": "London",
  "posted_date": "last7days",
  "results_wanted": 50,
  "collectDetails": true
}
```

## Configuration

- **Proxy Settings**: Use `proxyConfiguration` to specify proxies, ensuring compliance with Reed.co.uk's terms.
- **Rate Limiting**: The actor includes built-in delays to respect site policies.
- **Error Handling**: Automatically retries failed requests and logs issues.

## Cost Estimation

- **Free Tier**: Up to 1,000 jobs per run.
- **Paid Usage**: Costs depend on data volume and proxy usage. Refer to Apify pricing for details.

## Changelog

### Version 1.0.0
- Initial release with basic scraping functionality.

## Support

For issues or questions, please contact support through the Apify platform or check the actor's page for updates.
# Reed.co.uk Jobs Scraper

This Apify actor scrapes job listings from Reed.co.uk. It is designed to be fast and lightweight.

## Features

- Scrapes Reed.co.uk job search results.
- Extracts detailed job information including title, company, location, salary, and full description.
- Handles pagination to collect multiple pages of results.
- Works well with residential proxies to ensure reliable scraping.
- Saves results to a dataset.

## Input

The actor accepts the following input fields:

- `keyword`: The job title or keywords to search for.
- `location`: The geographic location to filter jobs by.
- `posted_date`: Filter jobs by when they were posted (e.g., "today", "last7days").
- `startUrl`: A specific Reed.co.uk search URL to start scraping from.
- `results_wanted`: The maximum number of jobs to scrape.
- `max_pages`: A safety cap on the number of listing pages to visit.
- `collectDetails`: If enabled, the actor will visit each job's detail page to extract the full description and other details.
- `cookies`: Custom cookies to use for the requests, which can help bypass banners.
- `proxyConfiguration`: Proxy settings for the scraper.

## Output

The actor outputs a dataset of job listings with the following fields:

- `url`: The URL of the job posting.
- `title`: The job title.
- `company`: The company name.
- `location`: The job location.
- `salary`: The salary information for the job.
- `datePosted`: When the job was posted (ISO date format).
- `employmentType`: The type of employment (e.g., "Full-time").
- `validThrough`: The date the job posting expires.
- `postalCode`: The postal code for the job location.
- `description_html`: The job description in HTML format.
- `description_text`: The job description in plain text.
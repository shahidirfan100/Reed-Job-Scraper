# Reed.co.uk API discovery

Checked on 2026-11-04 from a direct connection with impit 0.14.8. Every result below came from a live request, not from the previous actor notes.

## Selected request flow

1. Read a Reed search page and parse its embedded Next.js payload.
2. Enrich each job through the public BFF detail endpoint.
3. If the detail endpoint fails, parse the public job page instead.
4. If both detail sources fail, keep the search card data and its description snippet.

## Search page

- Endpoint: `https://www.reed.co.uk/jobs/{keyword}-jobs`, `https://www.reed.co.uk/jobs/{keyword}-jobs-in-{location}`, `https://www.reed.co.uk/jobs/jobs-in-{location}`, or `https://www.reed.co.uk/jobs`
- Method: `GET`
- Auth: none
- Payload: `script#__NEXT_DATA__` -> `props.pageProps.searchResults`
- Result count: `searchResults.count`
- Jobs array: `searchResults.jobs`
- Pagination: `pageno` (1-based). `page` is ignored by the site.
- Page size: `take`, 1 to 100. The default is 25.
- Keyword override: `keywords`. It preserves punctuation that the URL slug drops, such as `C++` and `R&D`.
- Location override: `locationName`.
- Posted date: `datecreatedoffset` with `today`, `lastthreedays`, `lastweek`, or `lasttwoweeks`.
- Bare `/jobs?keywords=...&location=...` redirects to a slug URL and loses `take` and the location, so the actor builds the slug path directly.

Live checks:

| Request | Result |
|---|---|
| `/jobs/administrative-assistant-jobs` | 200, 25 jobs, count 3,225 |
| `?take=100` | 200, 100 jobs |
| `?take=100&pageno=2` | 200, 100 different jobs |
| `?page=2` | 200, still page 1 |
| `?datecreatedoffset=today` | 200, count 23 |
| `?datecreatedoffset=lastweek` | 200, count 649 |
| `?datecreatedoffset=last7days` | 200, filter ignored |
| `/jobs/jobs-in-london` | 200, count 22,910 |
| `/jobs/software-engineer-jobs-in-london?locationName=London` | 200, count 1,097 |
| `/jobs/c-developer-jobs?keywords=C%2B%2B%20developer` | 200, keywords `C++ developer`, count 157 |

## Job detail endpoint

- Endpoint: `https://api.reed.co.uk/api-bff-jobseeker-jobs/job/consolidated/{jobId}/anonymous/`
- Method: `GET`
- Auth: none
- Required request context: `x-correlation-id` (fresh UUID), `x-correlation-source-id: web-jobseeker-jobs`, `origin: https://www.reed.co.uk`, `referer` set to the job URL
- Payload: `result.jobDetails`
- Description: `result.jobDetails.description` (HTML)
- Live check: 200, 18,245 bytes, 4,246 characters of description for job `57470553`
- 404 or 410 usually means the job is expired or removed. Live job IDs also returned 404 during the 2026-11-04 detail-service outage described below.

Useful detail fields:

- Identity: `id`, `title`, `description`, `taxonomy`, `breadcrumbs`
- Dates: `createdDate`, `updatedDate`, `displayDate`, `expiryDate`
- Contract: `jobContractType.name`, `jobEmploymentHours.isFullTime`, `jobEmploymentHours.isPartTime`
- Flags: `isPermanent`, `isContract`, `isTemp`, `isAgency`, `isEmployer`, `isReed`, `isEasyApply`, `isPromoted`, `isFeatured`, `isGraduate`, `isTrainingJob`
- Eligibility: `hasEligibilityToWorkInUk`, `jobApplicationEligibilityRequirement`
- Location: `jobLocation.locationName`, `townName`, `countyName`, `regionName`, `countryName`, `countryCode`, `postCode`, `isRemoteJob`, `inferredJobLocationType`
- Salary: `jobSalary.displaySalary`, `from`, `to`, `fromPerAnnum`, `toPerAnnum`, `currencyId`, `type.name`, `isNegotiable`
- Employer: `jobOwner.profileName`, `profileId`, `profileUrl`, `companyProfileId`, `companyProfileUrl`, `profileLogoImage`
- Classification: `jobSector.name`, `parentName`, `jobSkills[].name`

## Job page fallback

- Endpoint: `https://www.reed.co.uk/jobs/job/{jobId}`
- Method: `GET`
- Payload: `props.pageProps.consolidatedJobDetails.jobDetails`
- Live check: 200, 246,572 bytes
- The detail object matches the BFF shape, so the same mapper handles both sources.

## Browser and mobile profile checks

All profiles returned the search page, the BFF detail payload, and the job page with status 200.

| impit profile | Search page | Detail JSON | Job page | Result |
|---|---|---|---|---|
| `chrome` | 200 | 200 | 200 | works |
| `chrome142` | 200 | 200 | 200 | works |
| `chrome151` | 200 | 200 | 200 | works |
| `firefox` | 200 | 200 | 200 | works |
| `firefox144` | 200 | 200 | 200 | works |
| `firefox158` | 200 | 200 | 200 | works |
| `okhttp5` | 200 | 200 | 200 | works |
| `ios18` | 200 | 200 | 200 | works |

The actor starts with `chrome` and rotates through the rest after a block. No separate mobile API was needed, and no app-only token was found. The same public endpoints answer iOS and Android profiles.

## Candidates that were rejected

| Candidate | Result |
|---|---|
| Guessed BFF search routes such as `/job/search/anonymous/` | No route found in the client bundles |
| Public Reed developer API | Requires an API key and is not used by the public site |
| Bare `/jobs?keywords=&location=` | Redirects to a slug URL and drops filters |
| `page` query parameter | Ignored; the site uses `pageno` |
| `datecreatedoffset=last7days` | Ignored; the site uses `lastweek` |
| `dateCreatedOffSet=lastseven` | Ignored; the site uses `datecreatedoffset` |
| Search page HTML card parsing as the primary source | Kept only as a fallback because the JSON payload has more fields |
| A separate mobile or app host | None found; mobile profiles hit the same public endpoints |

## Output mapping notes

- `salaryMin` and `salaryMax` keep the site's raw values, which may be hourly, daily, or annual.
- `salaryPeriod` records the site's period text, such as `per annum` or `per hour`.
- `salaryAnnualMin` and `salaryAnnualMax` use the site's annualised values when published.
- `remoteWorkingOption` normalizes `onSite`, `remote`, and `hybrid` to `On-site`, `Remote`, and `Hybrid`.
- `employmentType` uses `jobContractType.name` from the detail endpoint.
- `taxonomyLevel1` and `taxonomyLevel2` use the second and third breadcrumb entries, which match the card taxonomy fields.
- Empty values are omitted from dataset records.

## Failure handling- 403, 429, 5xx, timeouts, and connection resets are retried with bounded backoff and a fresh browser profile.
- `Retry-After` is honored and capped at 20 seconds.
- A blocked or failed detail request falls back to the job page, then to the search snippet.
- Detail requests use a 12 second timeout and two attempts.
- After four consecutive detail failures, detail enrichment pauses for the rest of the run and the actor still saves card data. This keeps a Reed detail outage from exceeding the health-test window.
- If the detail service recovers later in the run, the first successful detail request resets the failure counter before the pause point.
- A page with no readable payload and no HTML job cards stops its source with a warning.
- If every source fails before any page is read, the run fails with a diagnostic message instead of succeeding with an empty dataset.
- If Reed legitimately returns no matching jobs, the run succeeds with an empty dataset.

## Observed upstream failure on 2026-11-04

At 10:26 UTC the BFF returned HTTP 500 with this message:

```text
upstream connect error or disconnect/reset before headers. retried and the latest reset reason: remote connection failure, transport failure reason: delayed connect error: Connection refused
```

At the same time, job detail pages returned HTTP 404 for IDs that were still present in the search payload. Search pages kept returning 200 with job cards. This is a Reed detail-service outage, not a parser regression. The actor saved the search snippets and finished with status `SUCCEEDED`.

Before changing the request shape after a failure, check the search page, the BFF detail endpoint, and the job page separately. A working search page with a failing BFF and 404 job pages means the detail service is down.

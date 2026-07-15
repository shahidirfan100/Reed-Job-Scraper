## Selected API

- Endpoint: `https://www.reed.co.uk/jobs/<criteria>?pageno=<page>`
- Method: `GET`
- Auth: `None`
- Pagination: `pageno` query parameter
- Data source used: Structured JSON payload returned with search pages
- Detail description source: `https://api.reed.co.uk/api-bff-jobseeker-jobs/job/consolidated/<jobId>/anonymous/`
- Detail method: `GET`
- Detail auth: `None`; requires `x-correlation-id` and `x-correlation-source-id: web-jobseeker-jobs`
- Detail query params: `includeGaTags=false`, `includeProfileDetails=false`, `includeSimilarSearches=false`, `includeSimilarJobs=false`, `includeRecommendedCourses=false`, `includeHiddenJobs=false`, `shortlistedJobsCount=0`
- Detail data source used: `result.jobDetails.description`

### Discovery Notes

- Discovered BFF base URL in runtime config: `https://api.reed.co.uk/api-bff-jobseeker-jobs/`
- Public BFF routes available from client bundles include:
  - `keyword/suggest/{keyword}/anonymous/`
  - `location/suggest/{query}/anonymous/`
  - `location/coordinates/anonymous/{lat,lon}`
- A direct public search-listings BFF route was not exposed from available client calls.
- Fallback selected (per updater rules): structured search payload on search-result pages.
- Full job descriptions are not reliably present in search result payloads. The selected detail source is the public BFF `job/consolidated/<jobId>/anonymous/` JSON endpoint; it returns full HTML description content without browser automation or loading the public job detail page.

### Fields Available (non-exhaustive)

- `jobId`, `jobTitle`, `jobType`, `jobDescription`
- `dateCreated`, `dateUpdated`, `displayDate`, `expiryDate`
- `displayLocationName`, `countyLocation`
- `salaryFrom`, `salaryTo`, `salaryDescription`, `salaryType`, `salaryCurrencyId`
- `ouId`, `ouName`, `ouType`, `ouTierId`, `profileId`
- `remoteWorkingOption`, `taxonomyLevel1`, `taxonomyLevel2`
- `isFullTime`, `isPartTime`, `isPriority`, `isPromoted`, `isTopJob`, `isTrainingJob`, `isEarlyBird`, `isEasyApply`, `eligibleUkOnly`
- `url`, `ouUrl`, `profileName`, `profileUrl`, `logoImage`
- Additional search-context fields such as page number and total count

### Field Count Comparison

- Previous actor output: limited fixed schema with null-heavy values
- Current mapping strategy: non-null dynamic mapping from structured payload + normalized fields
- Result: materially richer records with significantly fewer null fields

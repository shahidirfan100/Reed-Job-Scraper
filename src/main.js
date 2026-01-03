// Reed.co.uk jobs scraper - Listing-only mode (Fast & Stealthy)
// Runtime: Node 22, ESM ("type": "module")
// Uses apify@^3 and crawlee@^3

import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

// ------------------------- INPUT -------------------------
const input = await Actor.getInput() ?? {};
const {
    keyword = '',
    location = '',
    posted_date = 'anytime',
    results_wanted: RESULTS_WANTED_RAW = 100,
    max_pages: MAX_PAGES_RAW = 999,
    collectDetails = false, // Default to false (listing-only mode)
    startUrl,
    url,
    startUrls,
    proxyConfiguration,
} = input;

const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;

// ------------------------- HELPERS -------------------------
const slugify = (s) => (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildStartUrl = (kw, loc, date) => {
    if (!kw && !loc) {
        const url = new URL('https://www.reed.co.uk/jobs');
        if (date && date !== 'anytime') {
            if (date === 'today') url.searchParams.set('dateCreatedOffSet', 'today');
            else if (date === 'last3days') url.searchParams.set('dateCreatedOffSet', 'lastthree');
            else if (date === 'last7days') url.searchParams.set('dateCreatedOffSet', 'lastseven');
            else if (date === 'last14days') url.searchParams.set('dateCreatedOffSet', 'lastfourteen');
            else url.searchParams.set('dateCreatedOffSet', date);
        }
        return url.href;
    }
    const kwSlug = slugify(kw || '');
    if (!kwSlug) return 'https://www.reed.co.uk/jobs';
    if (loc && slugify(loc)) return `https://www.reed.co.uk/jobs/${kwSlug}-jobs-in-${slugify(loc)}`;
    return `https://www.reed.co.uk/jobs/${kwSlug}-jobs`;
};

const parseNextData = ($) => {
    try {
        const scriptContent = $('#__NEXT_DATA__').html();
        if (scriptContent) {
            return JSON.parse(scriptContent);
        }
    } catch (e) {
        log.warning(`Failed to parse __NEXT_DATA__: ${e.message}`);
    }
    return null;
};

const buildJobUrl = (relativeUrl) => {
    // The JSON contains URLs like "/software-engineer/54751693"
    // We need to prepend "/jobs/" to get "https://www.reed.co.uk/jobs/software-engineer/54751693"
    if (!relativeUrl) return null;
    const cleanUrl = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
    return `https://www.reed.co.uk/jobs${cleanUrl}`;
};

const getEmploymentType = (jobTypeCode) => {
    // Reed job type codes
    const types = {
        1: 'Permanent',
        2: 'Contract',
        3: 'Temporary',
        4: 'Part Time',
    };
    return types[jobTypeCode] || null;
};

// ------------------------- START URLS -------------------------
const builtStartUrl = buildStartUrl(keyword, location, posted_date);
const initialUrls = [];
if (Array.isArray(startUrls) && startUrls.length) initialUrls.push(...startUrls);
if (startUrl && typeof startUrl === 'string') initialUrls.push(startUrl);
if (url && typeof url === 'string') initialUrls.push(url);
if (!initialUrls.length) initialUrls.push(builtStartUrl);

// ------------------------- PROXY -------------------------
const proxyConf = proxyConfiguration
    ? await Actor.createProxyConfiguration(proxyConfiguration)
    : undefined;

// ------------------------- SHARED STATE -------------------------
let jobsScraped = 0;

// ------------------------- CRAWLER -------------------------
const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,
    maxRequestsPerMinute: 300,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,
    maxConcurrency: 10,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 50,
        sessionOptions: {
            maxUsageCount: 30,
            maxErrorScore: 3,
        },
    },
    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'User-Agent': request.headers['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...request.headers,
            };
        }
    ],

    async requestHandler({ request, $, log: crawlerLog, enqueueLinks }) {
        const { pageNo = 1 } = request.userData ?? {};

        // Extract __NEXT_DATA__
        const nextData = parseNextData($);
        if (!nextData) {
            crawlerLog.error(`Failed to extract __NEXT_DATA__ from ${request.url}`);
            return;
        }

        const searchResults = nextData.props?.pageProps?.searchResults;
        const jobs = searchResults?.jobs || [];

        if (!jobs.length) {
            crawlerLog.warning(`No jobs found in __NEXT_DATA__ on page ${pageNo}`);
            return;
        }

        crawlerLog.info(`Page ${pageNo}: Found ${jobs.length} jobs in __NEXT_DATA__`);

        // Process each job
        for (const job of jobs) {
            if (jobsScraped >= RESULTS_WANTED) {
                crawlerLog.info(`Reached target: ${jobsScraped}/${RESULTS_WANTED} jobs. Stopping.`);
                return;
            }

            const jobDetail = job.jobDetail || {};

            // Build the correct URL (add /jobs/ prefix)
            const jobUrl = buildJobUrl(job.url);

            // Extract salary
            let salary = null;
            if (jobDetail.salaryFrom && jobDetail.salaryTo) {
                salary = `£${jobDetail.salaryFrom.toLocaleString()} - £${jobDetail.salaryTo.toLocaleString()}`;
            } else if (jobDetail.salaryFrom) {
                salary = `£${jobDetail.salaryFrom.toLocaleString()}`;
            } else if (jobDetail.salaryTo) {
                salary = `Up to £${jobDetail.salaryTo.toLocaleString()}`;
            }

            const item = {
                url: jobUrl,
                jobId: jobDetail.jobId ? String(jobDetail.jobId) : null,
                title: jobDetail.jobTitle || null,
                company: jobDetail.ouName || job.profileName || null,
                employerId: job.profileUrl || null,
                location: jobDetail.displayLocationName || null,
                salary,
                salaryMin: jobDetail.salaryFrom || null,
                salaryMax: jobDetail.salaryTo || null,
                currency: 'GBP',
                datePosted: jobDetail.dateCreated || jobDetail.dateUpdated || null,
                employmentType: getEmploymentType(jobDetail.jobType),
                isFullTime: jobDetail.isFullTime || null,
                isFeatured: jobDetail.featuredLabel || false,
                isEasyApply: jobDetail.isEasyApply || false,
                applications: jobDetail.applications || null,
                description_text: jobDetail.jobDescription || null,
                _source: 'reed.co.uk',
                _fetchedAt: new Date().toISOString(),
                _from: 'list_nextdata',
            };

            await Dataset.pushData(item);
            jobsScraped++;
            crawlerLog.info(`✓ Job ${jobsScraped}/${RESULTS_WANTED} saved: ${item.title || 'Untitled'}`);
        }

        // Check if we should stop
        if (jobsScraped >= RESULTS_WANTED) {
            crawlerLog.info(`Target reached: ${jobsScraped}/${RESULTS_WANTED}. Stopping pagination.`);
            return;
        }

        // Check page limit
        if (pageNo >= MAX_PAGES) {
            crawlerLog.info(`Max pages (${MAX_PAGES}) reached. Stopping pagination.`);
            return;
        }

        // Pagination - build next page URL
        try {
            const currentUrl = new URL(request.url);
            const nextPageNo = pageNo + 1;
            currentUrl.searchParams.set('pageno', String(nextPageNo));
            const nextUrl = currentUrl.href;

            await enqueueLinks({
                urls: [nextUrl],
                userData: { pageNo: nextPageNo }
            });
            crawlerLog.info(`→ Next page enqueued: ${nextPageNo}`);
        } catch (e) {
            crawlerLog.error(`Failed to build next page URL: ${e.message}`);
        }
    },

    failedRequestHandler: async ({ request }, error) => {
        log.error(`Request ${request.url} failed: ${error.message}`);
    },
});

await crawler.run(initialUrls.map(u => ({ url: u, userData: { pageNo: 1 } })));
log.info(`✓ Scraping completed. Total jobs scraped: ${jobsScraped}/${RESULTS_WANTED}`);

await Actor.exit();
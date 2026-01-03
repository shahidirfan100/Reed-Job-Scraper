// Reed.co.uk jobs scraper (CheerioCrawler)
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

    collectDetails = true,

    startUrl,
    url,
    startUrls,

    cookies,
    cookiesJson,
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

const cleanLocation = (loc) => {
    if (!loc) return null;
    return loc.replace(/,\s*[A-Z]{2}$/, '').trim();
};

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

const toAbs = (href) => {
    try { return new URL(href, 'https://www.reed.co.uk').href; } catch { return null; }
};

// --- DATA PARSING HELPERS ---

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

// Fallback HTML Extraction for List
const collectJobLinksHtml = ($) => {
    const links = new Set();
    $('a[href]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        if (/^\/jobs\/[^\/]+\/\d+(\?|$)/.test(href)) links.add(toAbs(href));
    });
    return [...links];
};

const findNextUrl = ($, currentUrl) => {
    let nextHref = null;
    $('a[href]').each((_, a) => {
        const text = $(a).text().trim().toLowerCase();
        if (text === 'next' || $(a).find('.icon-next').length > 0) nextHref = $(a).attr('href');
    });
    if (nextHref) return toAbs(nextHref);

    try {
        const u = new URL(currentUrl);
        const current = Number(u.searchParams.get('pageno') || '1');
        u.searchParams.set('pageno', String(current + 1));
        return u.href;
    } catch {
        return null;
    }
};

const parseJsonLdJob = ($) => {
    const out = {};
    const scripts = $('script[type="application/ld+json"]');
    scripts.each((_, s) => {
        try {
            const txt = $(s).contents().text().trim();
            if (!txt) return;
            const parsed = JSON.parse(txt);
            const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
            for (let i = 0; i < queue.length; i++) {
                const it = queue[i];
                if (!it) continue;
                if (Array.isArray(it['@graph'])) queue.push(...it['@graph']);
                const types = Array.isArray(it['@type']) ? it['@type'] : [it['@type']];
                if (types.includes('JobPosting')) {
                    out.title = out.title ?? it.title;
                    out.datePosted = out.datePosted ?? it.datePosted;
                    out.validThrough = out.validThrough ?? it.validThrough;
                    out.employmentType = out.employmentType ?? it.employmentType;
                    out.hiringOrganization = out.hiringOrganization ?? (it.hiringOrganization?.name ?? it.hiringOrganization);
                    const jl = it.jobLocation;
                    if (jl && typeof jl === 'object') {
                        const addr = Array.isArray(jl) ? jl[0]?.address : jl.address;
                        if (addr) {
                            out.location = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
                                .filter(Boolean).join(', ');
                            out.postalCode = addr.postalCode;
                        }
                    }
                    if (it.baseSalary) {
                        const bs = it.baseSalary;
                        if (typeof bs === 'object') {
                            const v = bs.value;
                            if (typeof v === 'object') {
                                out.salary = [v.minValue, v.maxValue].filter(Boolean).join(' - ') || v.value;
                                if (!out.salary && v.value) out.salary = v.value;
                                out.salaryCurrency = v.currency || bs.currency;
                                out.salaryUnit = v.unitText || bs.unitText;
                            }
                        }
                    }
                    out.description_text = out.description_text ?? it.description;
                }
            }
        } catch { }
    });
    return out;
};

const findBestDescriptionContainer = ($) => {
    // Selectors ordered by specificity and likelihood
    const orderedSelectors = [
        '[data-qa="job-description"]',
        '.job-description',
        '*[itemprop="description"]',
        '.description',
        'article.job-details',
        'main',
    ];

    for (const sel of orderedSelectors) {
        const el = $(sel).first();
        if (el && el.length && el.text().trim().length > 50) return el;
    }

    return $('body');
};

// Sanitize job description HTML: remove ALL hyperlinks and unwanted tags
const sanitizeHtmlString = (rawHtml) => {
    if (!rawHtml) return '';
    let html = rawHtml
        .replace(/<\s*(script|style|nav|header|footer|button|svg|img|form|aside|iframe|noscript)[\s\S]*?<\/\s*\1\s*>/gi, '');

    // Remove ALL hyperlinks completely (anchor + inner text) - or just strip tags? 
    // Usually standard is to strip tags but keep text, but user prompt implies stealth/clean data.
    // Let's strip the A tags but keep the text, unless it's "Apply" buttons.
    html = html.replace(/<a[^>]*>.*?<\/a>/gi, '');

    // Strip attributes from allowed tags to make it clean
    html = html.replace(/<\s*(p|ul|ol|li|strong|em|h1|h2|h3|br)\b[^>]*>/gi, '<$1>');

    // Remove all other tags but keep content
    // html = html.replace(/<\/?(?!p|br|ul|ol|li|strong|em|h1|h2|h3)\w+[^>]*>/gi, '');

    return html.trim();
};

const htmlToText = (html) => (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/&nbsp;/g, ' ')
    .trim();

const normalizeCookieHeader = ({ cookies, cookiesJson }) => {
    if (cookies && typeof cookies === 'string' && cookies.trim()) return cookies.trim();
    if (cookiesJson && typeof cookiesJson === 'string') {
        try {
            const parsed = JSON.parse(cookiesJson);
            const parts = [];
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (typeof item === 'string') parts.push(item.trim());
                    else if (item && typeof item === 'object' && item.name) {
                        parts.push(`${item.name}=${item.value ?? ''}`);
                    }
                }
            } else if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) parts.push(`${k}=${v ?? ''}`);
            }
            if (parts.length) return parts.join('; ');
        } catch { }
    }
    return '';
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
let jobsScraped = 0; // Actual jobs pushed to dataset
let jobsEnqueued = 0; // Jobs enqueued for detail scraping
let shouldStopEnqueuing = false; // Stop enqueueing new jobs
const cookieHeader = normalizeCookieHeader({ cookies, cookiesJson });

// ------------------------- CRAWLER -------------------------
const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,
    maxRequestsPerMinute: 400, // Reduced slightly for better stealth
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,
    maxConcurrency: 5, // Conservative concurrency
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
            // Anti-blocking headers
            request.headers = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
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

            if (cookieHeader) {
                request.headers.Cookie = cookieHeader;
            }
        }
    ],

    async requestHandler({ request, $, log: crawlerLog, enqueueLinks }) {
        const { label, pageNo = 1 } = request.userData ?? {};

        // ------------------------- LIST PAGE -------------------------
        if (label === 'LIST' || !label) {
            let links = [];
            let jsonJobs = [];

            // 1. Try __NEXT_DATA__ Extraction
            const nextData = parseNextData($);
            if (nextData) {
                // Try different paths where jobs might settle
                const searchResults = nextData.props?.pageProps?.searchResults;
                const jobs = searchResults?.jobs || nextData.props?.pageProps?.jobs;

                if (Array.isArray(jobs)) {
                    crawlerLog.info(`[JSON LIST] Page ${pageNo}: Found ${jobs.length} jobs via __NEXT_DATA__`);
                    jsonJobs = jobs;
                }
            }

            // 2. Fallback to HTML if no JSON jobs found
            if (!jsonJobs.length) {
                links = collectJobLinksHtml($);
                crawlerLog.info(`[HTML LIST] Page ${pageNo}: Found ${links.length} jobs via HTML selectors`);
            } else {
                // Convert JSON jobs to links
                links = jsonJobs
                    .map(j => j.jobUrl || j.url)
                    .filter(Boolean)
                    .map(u => toAbs(u));
            }

            crawlerLog.info(`LIST Page ${pageNo} summary: ${links.length} valid links found.`);

            if (!collectDetails) {
                // ---------------- Direct Push (Lite Mode) ----------------
                for (let i = 0; i < links.length; i++) {
                    if (jobsScraped >= RESULTS_WANTED) {
                        shouldStopEnqueuing = true;
                        break;
                    }

                    // If we have JSON data, use it to populate the dataset
                    const jobData = jsonJobs[i] || {};
                    const link = links[i];

                    const item = {
                        url: link,
                        jobId: jobData.id || jobData.jobId || null,
                        title: jobData.jobTitle || jobData.title || null,
                        company: jobData.employerName || null,
                        employerId: jobData.employerId || null,
                        location: jobData.locationName || null,
                        salary: jobData.salary || (jobData.minimumSalary && jobData.maximumSalary ? `${jobData.minimumSalary} - ${jobData.maximumSalary}` : (jobData.minimumSalary || jobData.maximumSalary || null)),
                        currency: jobData.currency || 'GBP',
                        datePosted: jobData.dateCreated || jobData.datePosted || null,
                        expirationDate: jobData.expirationDate || null,
                        applications: jobData.applications || null,
                        jobTitleId: jobData.jobTitleId || null,
                        isFeatured: jobData.featured || false,
                        description_text: jobData.jobDescription || null, // Sometimes short desc available in list
                        _source: 'reed.co.uk',
                        _fetchedAt: new Date().toISOString(),
                        _from: jsonJobs.length ? 'list_json' : 'list_html'
                    };

                    await Dataset.pushData(item);
                    jobsScraped++;
                    crawlerLog.info(`✓ Job ${jobsScraped}/${RESULTS_WANTED} saved (list mode)`);
                }
            } else {
                // ---------------- Detail Mode ----------------
                if (!shouldStopEnqueuing) {
                    const remaining = RESULTS_WANTED - jobsEnqueued;
                    const linksToEnqueue = links.slice(0, Math.max(0, remaining));

                    if (linksToEnqueue.length > 0) {
                        await enqueueLinks({
                            urls: linksToEnqueue,
                            userData: { label: 'DETAIL' }
                        });
                        jobsEnqueued += linksToEnqueue.length;
                        crawlerLog.info(`→ Enqueued ${linksToEnqueue.length} detail pages | Total enqueued: ${jobsEnqueued}/${RESULTS_WANTED}`);
                    }

                    if (jobsEnqueued >= RESULTS_WANTED) {
                        shouldStopEnqueuing = true;
                        crawlerLog.info(`✓ Reached target: ${jobsEnqueued} jobs enqueued. Stopping pagination.`);
                        return;
                    }
                }
            }

            // Check if we should stop pagination
            if (shouldStopEnqueuing || jobsScraped >= RESULTS_WANTED) {
                crawlerLog.info(`Stopping pagination. Scraped: ${jobsScraped}, Enqueued: ${jobsEnqueued}`);
                return;
            }

            // Check page limit
            if (pageNo >= MAX_PAGES) {
                crawlerLog.info(`Max pages (${MAX_PAGES}) reached. Stopping pagination.`);
                return;
            }

            // Pagination Logic
            const nextUrl = findNextUrl($, request.url);
            if (nextUrl) {
                await enqueueLinks({
                    urls: [nextUrl],
                    userData: { label: 'LIST', pageNo: pageNo + 1 }
                });
                crawlerLog.info(`→ Next page enqueued: ${pageNo + 1}`);
            } else {
                crawlerLog.info(`No next page found. End of results.`);
            }
            return;
        }

        // ------------------------- DETAIL PAGE -------------------------
        if (label === 'DETAIL') {
            if (jobsScraped >= RESULTS_WANTED) {
                return;
            }

            // 1. Prioritize JSON-LD (Standard for Jobs)
            const jsonld = parseJsonLdJob($);

            // 2. Fallback/Augment with __NEXT_DATA__
            const nextData = parseNextData($);
            const nextJob = nextData?.props?.pageProps?.job || {};

            // 3. Fallback/Augment with HTML
            const title = jsonld.title || nextJob.title || nextJob.jobTitle || $('h1').first().text().trim();
            const company = jsonld.hiringOrganization || nextJob.employerName || $('h1').parent().find('a.employer-name').text().trim();

            // Construct salary
            let salary = jsonld.salary;
            if (!salary && nextJob.salary) {
                if (typeof nextJob.salary === 'object') {
                    const min = nextJob.salary.minValue || nextJob.minimumSalary;
                    const max = nextJob.salary.maxValue || nextJob.maximumSalary;
                    if (min && max) salary = `${min} - ${max}`;
                    else salary = min || max || nextJob.salary.value;
                } else {
                    salary = nextJob.salary;
                }
            }
            if (!salary && (nextJob.minimumSalary || nextJob.maximumSalary)) {
                salary = `${nextJob.minimumSalary || ''} - ${nextJob.maximumSalary || ''}`;
            }
            if (!salary) {
                salary = $('[data-qa="salary-amount"], .salary').text().trim();
            }

            // Construct location
            let locationText = jsonld.location;
            if (!locationText && nextJob.locationName) locationText = nextJob.locationName;
            if (!locationText && nextJob.location) {
                // Sometimes nextJob.location is an object
                locationText = nextJob.location.locationName || nextJob.location.town || nextJob.location.region;
            }
            if (!locationText) locationText = $('[data-qa="job-location"], .location').text().trim();
            locationText = cleanLocation(locationText);

            // Description
            const container = findBestDescriptionContainer($);
            let description_html = sanitizeHtmlString(container?.html?.() || '');

            // If HTML description is empty, try to get it from NEXT_DATA
            if (!description_html && nextJob.description) {
                description_html = sanitizeHtmlString(nextJob.description);
            }

            // Final fallback
            if (!description_html || description_html.length < 50) {
                const broad = $('article, main').first().html() || $('body').html() || '';
                description_html = sanitizeHtmlString(broad);
            }

            const description_text = jsonld.description_text || htmlToText(description_html);

            const item = {
                url: request.url,
                jobId: nextJob.jobId || nextJob.id || null, // Reed internal ID
                title: title || null,
                company: company || null,
                employerId: nextJob.employerId || null,
                location: locationText || null,
                postalCode: jsonld.postalCode || nextJob.postalCode || null,
                salary: salary || null,
                salaryMin: nextJob.minimumSalary || null,
                salaryMax: nextJob.maximumSalary || null,
                currency: nextJob.currency || jsonld.salaryCurrency || 'GBP',
                datePosted: jsonld.datePosted || nextJob.datePosted || nextJob.dateCreated || null,
                dateExpires: jsonld.validThrough || nextJob.expirationDate || null,
                employmentType: jsonld.employmentType || nextJob.contractType || null,
                applications: nextJob.applications || null,
                jobTitleId: nextJob.jobTitleId || null,
                description_html,
                description_text,
                _source: 'reed.co.uk',
                _fetchedAt: new Date().toISOString(),
                _from: jsonld.title ? 'detail_jsonld' : (nextJob.title ? 'detail_nextdata' : 'detail_html'),
            };

            await Dataset.pushData(item);
            jobsScraped++;
            crawlerLog.info(`✓ Job ${jobsScraped}/${RESULTS_WANTED} saved: ${title || 'Untitled'} (${item._from})`);
        }
    },

    // Add failure handler for better error recovery
    failedRequestHandler: async ({ request }, error) => {
        log.error(`Request ${request.url} failed: ${error.message}`);
    },
});

await crawler.run(initialUrls.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
log.info(`✓ Scraping completed. Total jobs scraped: ${jobsScraped}/${RESULTS_WANTED} | Jobs enqueued: ${jobsEnqueued}`);

await Actor.exit();
// Reed.co.uk jobs scraper (HTTP-only + Cheerio)
// Runtime: Node 22, ESM ("type": "module")
// SDKs: apify@^3, crawlee@^3
//
// This version preserves the existing structure (Actor + CheerioCrawler + Dataset),
// but replaces selectors, URL building, and pagination logic specifically for Reed.co.uk.
//
// Key behaviours retained from your prior main.js:
// - Uses CheerioCrawler (HTTP-only) for performance (no headless browser)
// - Respects 'results_wanted' cap
// - Supports proxyConfiguration from input
// - Pushes rich job objects to the default dataset
// - Robust pagination with graceful stop conditions
//
// New bits for Reed:
// - Start URL builder that matches Reed path style (e.g. /jobs/<kw>-jobs[-in-<location>])
// - Pagination via ?pageno=2,3,... until either no links or results cap hit
// - Job links found with a conservative regex for /jobs/<slug>/<id>
// - Detail extractor prefers JSON-LD JobPosting. Falls back to DOM heuristics if unavailable
//
// NOTE: Always respect Reed.co.uk Terms and robots.txt when running at scale.
//
// Example INPUT (Actor input JSON):
// {
//   "keyword": "software developer",
//   "location": "London",
//   "posted_date": "anytime", // reserved; filter currently not mapped because Reed exposes it via UI facets
//   "results_wanted": 100,
//   "proxyConfiguration": { "useApifyProxy": true, "groups": ["RESIDENTIAL"] }
// }

import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset, ProxyConfiguration } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() ?? {};
const {
    keyword = 'software developer',
    location,
    // Reed exposes posted date filters in the UI; query params are not stable/public.
    // We'll keep this field for compatibility and possible future mapping.
    posted_date = 'anytime',
    results_wanted = 100,
    max_pages = 999, // safety valve
    proxyConfiguration,
    // optional: startUrls to override URL building entirely
    startUrls = [],
} = input;

let jobCount = 0;

// ---- Helpers ---------------------------------------------------------------
const slugify = (s) => (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Reed friendly start URL builder.
// Examples:
//   kw only:     https://www.reed.co.uk/jobs/software-developer-jobs
//   kw+loc:      https://www.reed.co.uk/jobs/software-developer-jobs-in-london
const buildStartUrl = (kw, loc) => {
    const kwSlug = slugify(kw || '');
    if (!kwSlug) return 'https://www.reed.co.uk/jobs';
    if (loc && slugify(loc)) return `https://www.reed.co.uk/jobs/${kwSlug}-jobs-in-${slugify(loc)}`;
    return `https://www.reed.co.uk/jobs/${kwSlug}-jobs`;
};

const toAbs = (href) => {
    try {
        return new URL(href, 'https://www.reed.co.uk').href;
    } catch {
        return null;
    }
};

// Extracts unique job detail links from a list page.
// Reed detail URLs look like: /jobs/<slug>/<id>?source=searchResults
const collectJobLinks = ($) => {
    const links = new Set();
    $('a[href]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        // Strict-ish match: must have /jobs/<something>/<digits>
        if (/^\/jobs\/[^\/]+\/\d+(\?|$)/.test(href)) links.add(toAbs(href));
    });
    return [...links];
};

// Find the "Next" page (if present). We prefer the explicit "Next" anchor, else we increment pageno.
const findNextUrl = ($, currentUrl) => {
    // Try to locate an anchor with text "Next"
    let nextHref = null;
    $('a[href*="pageno="]').each((_, a) => {
        const text = $(a).text().trim().toLowerCase();
        if (text === 'next') nextHref = $(a).attr('href');
    });
    if (nextHref) return toAbs(nextHref);

    // Fallback: increment pageno query param even if "Next" anchor not found
    try {
        const u = new URL(currentUrl);
        const current = Number(u.searchParams.get('pageno') || '1');
        u.searchParams.set('pageno', String(current + 1));
        return u.href;
    } catch {
        return null;
    }
};

// Parse JSON-LD JobPosting if present. Returns {} if absent.
const parseJsonLdJob = ($) => {
    const out = {};
    const scripts = $('script[type="application/ld+json"]');
    scripts.each((_, s) => {
        try {
            let txt = $(s).contents().text().trim();
            if (!txt) return;
            // Some sites embed multiple JSON objects or arrays.
            const parsed = JSON.parse(txt);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const it of items) {
                if (!it) continue;
                // Sometimes JSON-LD is under "@graph"
                const graph = it['@graph'];
                if (Array.isArray(graph)) items.push(...graph);
            }
            for (const it of items) {
                if (it && (it['@type'] === 'JobPosting' || (Array.isArray(it['@type']) && it['@type'].includes('JobPosting')))) {
                    out.title = out.title ?? it.title;
                    out.datePosted = out.datePosted ?? it.datePosted;
                    out.validThrough = out.validThrough ?? it.validThrough;
                    out.employmentType = out.employmentType ?? it.employmentType;
                    out.hiringOrganization = out.hiringOrganization ?? (it.hiringOrganization?.name ?? it.hiringOrganization);
                    // Location can be nested
                    const jl = it.jobLocation || it.jobLocationType;
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
                                out.salary = [v.minValue, v.maxValue, v.value].filter(Boolean).join(' - ') || v;
                                out.salaryCurrency = v.currency || bs.currency;
                                out.salaryUnit = v.unitText || bs.unitText;
                            }
                        }
                    }
                    out.description_html = out.description_html ?? it.description;
                }
            }
        } catch {
            // ignore
        }
    });
    return out;
};

const htmlToText = (html) => (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// ---- Build initial request list -------------------------------------------
const startUrl = startUrls?.length ? startUrls[0] : buildStartUrl(keyword, location);
log.info(`Start URL: ${startUrl}`);
log.info(`Target results: ${results_wanted}`);

const proxyConf = proxyConfiguration
    ? await ProxyConfiguration.create(proxyConfiguration)
    : undefined;

const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,
    // Politeness
    maxRequestsPerMinute: 600,
    requestHandlerTimeoutSecs: 45,
    navigationTimeoutSecs: 45,
    async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
        const { label } = request.userData ?? {};

        // LIST pages: collect job detail links & enqueue next page
        if (label === 'LIST' || !label) {
            const links = collectJobLinks($);
            crawlerLog.info(`(${request.loadedUrl}) Found ${links.length} job links on this page.`);

            // Enqueue details until we reach results_wanted
            for (const url of links) {
                if (jobCount >= results_wanted) break;
                await Actor.pushData({ __seed_link: url }); // optional traceability
                await crawler.addRequests([{
                    url,
                    userData: { label: 'DETAIL' },
                }]);
            }

            // Stop if already satisfied
            if (jobCount >= results_wanted) return;

            // Pagination
            const nextUrl = findNextUrl($, request.loadedUrl || request.url);
            if (!nextUrl) {
                crawlerLog.info('No next page detected. Stopping pagination.');
                return;
            }
            // Derive current page number to prevent infinite loops
            const urlObj = new URL(request.loadedUrl || request.url);
            const currentPage = Number(urlObj.searchParams.get('pageno') || '1');
            if (currentPage >= max_pages) {
                crawlerLog.info(`Reached max_pages=${max_pages}.`);
                return;
            }
            await crawler.addRequests([{
                url: nextUrl,
                userData: { label: 'LIST' },
            }]);
            return;
        }

        // DETAIL pages: extract job data
        if (label === 'DETAIL') {
            if (jobCount >= results_wanted) return;

            const jsonld = parseJsonLdJob($);

            // DOM fallbacks
            const title = jsonld.title || $('h1').first().text().trim() || $('h1,h2').first().text().trim();
            // Company often appears near the header as a link. We try nearby anchors around the heading.
            let company = jsonld.hiringOrganization || $('h1').nextAll('a').first().text().trim();
            if (!company) {
                const maybeCompany = $('a[href*="/jobs/"]').first().text().trim();
                if (maybeCompany && maybeCompany.length < 80) company = maybeCompany;
            }

            // Salary & Location fallback: look for bullet list near header
            const headerBlock = $('h1').closest('div,section,article');
            const bullets = headerBlock.find('li').map((_, li) => $(li).text().trim()).get().filter(Boolean);
            let salary = jsonld.salary || bullets.find(t => /£|salary/i.test(t)) || '';
            let locationText = jsonld.location || bullets.find(t => /,|shire|london|manchester|wales|scotland|town|city|county/i.test(t)) || '';

            // Description: prefer JSON-LD HTML; else main content section
            let description_html = jsonld.description_html;
            if (!description_html) {
                // Reed's description sits in the primary content area; collect a broad but safe slice
                const content = $('main,article,section')
                    .filter((_, el) => $(el).text().includes('Apply')) // crude anchor around action area
                    .first();
                if (content && content.length) description_html = content.html();
                if (!description_html) {
                    // broader fallback
                    description_html = $('#content, .job, .content').first().html() || '';
                }
            }
            const description_text = htmlToText(description_html);

            const item = {
                url: request.loadedUrl || request.url,
                title: title || null,
                company: company || null,
                location: locationText || null,
                salary: salary || null,
                datePosted: jsonld.datePosted || null,
                employmentType: jsonld.employmentType || null,
                validThrough: jsonld.validThrough || null,
                postalCode: jsonld.postalCode || null,
                description_html: description_html || null,
                description_text: description_text || null,
                // Diagnostics
                _source: 'reed.co.uk',
                _fetchedAt: new Date().toISOString(),
            };

            await Dataset.pushData(item);
            jobCount += 1;

            if (jobCount % 25 === 0) log.info(`Scraped ${jobCount} jobs so far...`);
            return;
        }
    },
    failedRequestHandler({ request, log: crawlerLog }) {
        crawlerLog.warning(`Request failed ${request.url}`);
    },
});

log.info(`Starting scrape for keyword="${keyword}" location="${location || ''}" (posted_date=${posted_date})`);

const initialRequests = startUrls?.length
    ? startUrls.map((url) => ({ url, userData: { label: 'LIST' } }))
    : [{ url: startUrl, userData: { label: 'LIST' } }];

await crawler.run(initialRequests);

log.info(`Done. Total jobs scraped: ${jobCount}`);

await Actor.exit();

// Reed.co.uk jobs scraper (HTTP-only + Cheerio)
// Runtime: Node 22, ESM ("type": "module")
// SDKs: apify@^3, crawlee@^3
//
// This version preserves the existing structure (Actor + CheerioCrawler + Dataset),
// but replaces selectors, URL building, and pagination logic specifically for Reed.co.uk.
//
// Key behaviours retained / added:
// - Uses CheerioCrawler (HTTP-only) for performance (no headless browser)
// - Respects 'results_wanted' cap
// - Supports proxyConfiguration via Actor.createProxyConfiguration (fixes ProxyConfiguration.create error)
// - Cookie support (raw header or JSON forms) + session pool with cookie persistence
// - Pushes rich job objects to the default dataset
// - Robust pagination via ?pageno=2.. and "Next" anchor fallback
//
// Example INPUT:
// {
//   "keyword": "software developer",
//   "location": "London",
//   "posted_date": "anytime",
//   "results_wanted": 100,
//   "max_pages": 999,
//   "collectDetails": true,
//   "cookies": "consent=true; abc=123",
//   "cookiesJson": "{\"session\":\"xyz\"}",
//   "startUrl": "https://www.reed.co.uk/jobs/software-developer-jobs-in-london",
//   "proxyConfiguration": { "useApifyProxy": true, "groups": ["RESIDENTIAL"] }
// }

import { Actor, log } from 'apify';
import {
    CheerioCrawler,
    Dataset,
} from 'crawlee';

await Actor.init();

// ------------------------- INPUT -------------------------
const input = await Actor.getInput() ?? {};
const {
    // Reed-centric fields
    keyword = 'software developer',
    location,
    posted_date = 'anytime',

    // Limits
    results_wanted: RESULTS_WANTED_RAW = 100,
    max_pages: MAX_PAGES_RAW = 999,

    // Flow
    collectDetails = true,

    // Start URL compatibility
    startUrl,       // preferred single-URL
    url,            // legacy single-URL (compat)
    startUrls,      // legacy array (compat)

    // Cookies & proxy
    cookies,        // raw "Cookie" header string
    cookiesJson,    // JSON for cookies (array/object/map)
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

const buildStartUrl = (kw, loc) => {
    const kwSlug = slugify(kw || '');
    if (!kwSlug) return 'https://www.reed.co.uk/jobs';
    if (loc && slugify(loc)) return `https://www.reed.co.uk/jobs/${kwSlug}-jobs-in-${slugify(loc)}`;
    return `https://www.reed.co.uk/jobs/${kwSlug}-jobs`;
};

const toAbs = (href) => {
    try { return new URL(href, 'https://www.reed.co.uk').href; } catch { return null; }
};

// Collect unique job detail links from a listing page (strict-ish pattern)
const collectJobLinks = ($) => {
    const links = new Set();
    $('a[href]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        // /jobs/<slug>/<id>
        if (/^\/jobs\/[^\/]+\/\d+(\?|$)/.test(href)) links.add(toAbs(href));
    });
    return [...links];
};

// Find the "Next" page; prefer explicit anchor, fallback to incrementing ?pageno
const findNextUrl = ($, currentUrl) => {
    // 1) Try an explicit "Next" anchor
    let nextHref = null;
    $('a[href]').each((_, a) => {
        const text = $(a).text().trim().toLowerCase();
        if (text === 'next') {
            nextHref = $(a).attr('href');
        }
    });
    if (nextHref) return toAbs(nextHref);

    // 2) Fallback: increment ?pageno
    try {
        const u = new URL(currentUrl);
        const current = Number(u.searchParams.get('pageno') || '1');
        u.searchParams.set('pageno', String(current + 1));
        return u.href;
    } catch {
        return null;
    }
};

// Prefer JSON-LD JobPosting data from the detail page
const parseJsonLdJob = ($) => {
    const out = {};
    const scripts = $('script[type="application/ld+json"]');
    scripts.each((_, s) => {
        try {
            let txt = $(s).contents().text().trim();
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
            // ignore malformed JSON-LD
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

// Normalize cookie header from raw or JSON
const normalizeCookieHeader = ({ cookies, cookiesJson }) => {
    if (cookies && typeof cookies === 'string' && cookies.trim()) return cookies.trim();

    if (cookiesJson && typeof cookiesJson === 'string') {
        try {
            const parsed = JSON.parse(cookiesJson);
            const parts = [];

            // Array form: ["a=1", {"name":"b","value":"2"}]
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (typeof item === 'string') {
                        const s = item.trim();
                        if (s) parts.push(s);
                    } else if (item && typeof item === 'object' && item.name) {
                        const v = item.value ?? '';
                        parts.push(`${item.name}=${v}`);
                    }
                }
            // Object map: {"a":"1","b":"2"}
            } else if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                    parts.push(`${k}=${v ?? ''}`);
                }
            }
            if (parts.length) return parts.join('; ');
        } catch {
            // ignore parse errors
        }
    }
    return '';
};

// ------------------------- START URLS -------------------------
const builtStartUrl = buildStartUrl(keyword, location);

// Build an initial request list from the most compatible sources:
// 1) startUrls[] (legacy array) -> many
// 2) startUrl (preferred) -> one
// 3) url (legacy single) -> one
// 4) builder (keyword+location)
const initialUrls = [];
if (Array.isArray(startUrls) && startUrls.length) initialUrls.push(...startUrls);
if (startUrl && typeof startUrl === 'string') initialUrls.push(startUrl);
if (url && typeof url === 'string') initialUrls.push(url);
if (!initialUrls.length) initialUrls.push(builtStartUrl);

// ------------------------- PROXY & REQUEST QUEUE -------------------------
const proxyConf = proxyConfiguration
    ? await Actor.createProxyConfiguration(proxyConfiguration)
    : undefined;

const requestQueue = await Actor.openRequestQueue();
for (const u of initialUrls) {
    await requestQueue.addRequest({ url: u, userData: { label: 'LIST', pageNo: 1 } });
}

// ------------------------- CRAWLER -------------------------
let jobCount = 0;
const cookieHeader = normalizeCookieHeader({ cookies, cookiesJson });

const crawler = new CheerioCrawler({
    requestQueue,
    proxyConfiguration: proxyConf,

    // Politeness / stability
    maxRequestsPerMinute: 600,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,

    // Sessions + cookies persistence
    useSessionPool: true,
    persistCookiesPerSession: true,

    // Inject custom cookies if provided
    preNavigationHooks: [
        async ({ request, session }) => {
            // Apply user-provided Cookie header
            if (cookieHeader) {
                request.headers = request.headers || {};
                // Merge with any existing cookie header
                if (request.headers.Cookie || request.headers.cookie) {
                    const prev = request.headers.Cookie || request.headers.cookie;
                    request.headers.Cookie = `${prev}; ${cookieHeader}`;
                } else {
                    request.headers.Cookie = cookieHeader;
                }
            }
            // Persist session cookies: Crawlee handles Set-Cookie into session jar automatically
            if (session) {
                // nothing required; persistCookiesPerSession=true will store cookies from responses
            }
        },
    ],

    async requestHandler({ request, $, log: crawlerLog }) {
        const { label } = request.userData ?? {};

        // ---------------- LIST PAGE ----------------
        if (label === 'LIST' || !label) {
            const pageUrl = request.loadedUrl || request.url;
            const currentPage = Number(new URL(pageUrl).searchParams.get('pageno') || request.userData?.pageNo || 1);

            const links = collectJobLinks($);
            crawlerLog.info(`LIST: ${pageUrl} -> found ${links.length} job links (page ${currentPage}).`);

            // If user doesn't want details, push minimal items directly
            if (!collectDetails) {
                for (const link of links) {
                    if (jobCount >= RESULTS_WANTED) break;

                    // Try to pick a title text near the link (best-effort)
                    let title = '';
                    try {
                        const el = $(`a[href="${new URL(link).pathname}"]`).first();
                        title = el.text().trim();
                    } catch { /* ignore */ }

                    await Dataset.pushData({
                        url: link,
                        title: title || null,
                        _source: 'reed.co.uk',
                        _fetchedAt: new Date().toISOString(),
                        _from: 'list',
                    });
                    jobCount += 1;
                }
            } else {
                // Enqueue detail pages
                for (const link of links) {
                    if (jobCount >= RESULTS_WANTED) break;
                    await requestQueue.addRequest({ url: link, userData: { label: 'DETAIL' } });
                }
            }

            // Stop if satisfied
            if (jobCount >= RESULTS_WANTED) return;

            // Pagination
            if (currentPage >= MAX_PAGES) {
                crawlerLog.info(`Reached max_pages=${MAX_PAGES}. Stopping pagination.`);
                return;
            }
            const nextUrl = findNextUrl($, pageUrl);
            if (!nextUrl) {
                crawlerLog.info('No next page detected. Stopping pagination.');
                return;
            }
            await requestQueue.addRequest({ url: nextUrl, userData: { label: 'LIST', pageNo: currentPage + 1 } });
            return;
        }

        // ---------------- DETAIL PAGE ----------------
        if (label === 'DETAIL') {
            if (jobCount >= RESULTS_WANTED) return;

            const pageUrl = request.loadedUrl || request.url;

            const jsonld = parseJsonLdJob($);
            const title = jsonld.title || $('h1').first().text().trim() || $('h1,h2').first().text().trim();

            // Company guess: nearby anchors after h1, else a conservative anchor near header
            let company = jsonld.hiringOrganization || $('h1').nextAll('a').first().text().trim();
            if (!company) {
                const maybeCompany = $('a[href*="/jobs/"]').first().text().trim();
                if (maybeCompany && maybeCompany.length < 100) company = maybeCompany;
            }

            // Salary & location fallback: header bullets near the title
            const headerBlock = $('h1').closest('div,section,article');
            const bullets = headerBlock.find('li').map((_, li) => $(li).text().trim()).get().filter(Boolean);
            let salary = jsonld.salary || bullets.find(t => /£|salary/i.test(t)) || '';
            let locationText = jsonld.location || bullets.find(t => /,|shire|london|manchester|wales|scotland|town|city|county|remote/i.test(t)) || '';

            // Description: prefer JSON-LD HTML; else main content slice
            let description_html = jsonld.description_html;
            if (!description_html) {
                const content = $('main,article,section')
                    .filter((_, el) => $(el).text().toLowerCase().includes('apply'))
                    .first();
                if (content && content.length) description_html = content.html();
                if (!description_html) {
                    description_html = $('#content, .job, .content').first().html() || '';
                }
            }
            const description_text = htmlToText(description_html);

            const item = {
                url: pageUrl,
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
                _from: 'detail',
            };

            await Dataset.pushData(item);
            jobCount += 1;

            if (jobCount % 25 === 0) log.info(`Scraped ${jobCount} jobs...`);
            return;
        }
    },

    failedRequestHandler({ request, error, log: crawlerLog }) {
        crawlerLog.warning(`Request failed: ${request.url} :: ${error?.message || error}`);
    },
});

const effectiveStart = initialUrls.length ? initialUrls[0] : builtStartUrl;
log.info(`Start URL: ${effectiveStart}`);
log.info(`Target results: ${RESULTS_WANTED}`);
log.info(`Max pages: ${MAX_PAGES}`);
log.info(`Collect details: ${collectDetails ? 'yes' : 'no'}`);
if (cookies || cookiesJson) log.info('Custom cookies: enabled');

await crawler.run();
log.info(`Done. Total jobs scraped: ${jobCount}`);

await Actor.exit();
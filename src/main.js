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
    // Default jobs page with date filter
    if (!kw && !loc) {
        const url = new URL('https://www.reed.co.uk/jobs');
        if (date && date !== 'anytime') {
            if (date === 'last3days') url.searchParams.set('dateCreatedOffSet', 'lastthree');
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

const collectJobLinks = ($) => {
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
        if (text === 'next') nextHref = $(a).attr('href');
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
                                out.salary = [v.minValue, v.maxValue, v.value].filter(Boolean).join(' - ') || v;
                                out.salaryCurrency = v.currency || bs.currency;
                                out.salaryUnit = v.unitText || bs.unitText;
                            }
                        }
                    }
                    out.description_text = out.description_text ?? it.description;
                }
            }
        } catch {}
    });
    return out;
};

// Clean description HTML: keep only text content tags
const sanitizeDescriptionHtml = ($container) => {
    if (!$container || !$container.length) return '';
    // Clone to avoid mutating the original DOM
    const clone = $container.clone();
    // Remove scripts, styles, navs, buttons, svgs, etc.
    clone.find('script, style, nav, header, footer, button, svg, img, form, aside').remove();
    // Strip attributes from all elements
    clone.find('*').each((_, el) => {
        const attribs = Object.keys(el.attribs || {});
        for (const a of attribs) {
            delete el.attribs[a];
        }
    });
    // Keep only relevant container tags
    return clone.html() || '';
};

const htmlToText = (html) => (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
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
        } catch {}
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

// ------------------------- CRAWLER -------------------------
let jobCount = 0;
const cookieHeader = normalizeCookieHeader({ cookies, cookiesJson });

const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,
    maxRequestsPerMinute: 600,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,
    useSessionPool: true,
    persistCookiesPerSession: true,
    preNavigationHooks: [async ({ request }) => {
        if (cookieHeader) {
            request.headers = request.headers || {};
            request.headers.Cookie = cookieHeader;
        }
    }],
    async requestHandler({ request, $, log: crawlerLog, enqueueLinks }) {
        const { label, pageNo = 1 } = request.userData ?? {};

        if (label === 'LIST' || !label) {
            const links = collectJobLinks($);
            crawlerLog.info(`LIST: ${request.url} -> ${links.length} jobs.`);

            if (!collectDetails) {
                for (const link of links) {
                    if (jobCount >= RESULTS_WANTED) break;
                    await Dataset.pushData({ url: link, _source: 'reed.co.uk', _fetchedAt: new Date().toISOString(), _from: 'list' });
                    jobCount++;
                }
            } else {
                for (const link of links) {
                    if (jobCount >= RESULTS_WANTED) break;
                    await enqueueLinks({ urls: [link], userData: { label: 'DETAIL' } });
                }
            }
            if (jobCount >= RESULTS_WANTED) return;
            if (pageNo >= MAX_PAGES) return;
            const nextUrl = findNextUrl($, request.url);
            if (nextUrl) {
                await enqueueLinks({ urls: [nextUrl], userData: { label: 'LIST', pageNo: pageNo + 1 } });
            }
            return;
        }

        if (label === 'DETAIL') {
            if (jobCount >= RESULTS_WANTED) return;
            const jsonld = parseJsonLdJob($);
            const title = jsonld.title || $('h1').first().text().trim();
            let company = jsonld.hiringOrganization || $('h1').nextAll('a').first().text().trim();
            const headerBlock = $('h1').closest('div,section,article');
            const bullets = headerBlock.find('li').map((_, li) => $(li).text().trim()).get().filter(Boolean);
            let salary = jsonld.salary || bullets.find(t => /£|salary/i.test(t)) || '';
            let locationText = cleanLocation(jsonld.location || bullets.find(t => /,|shire|london|manchester|remote|county/i.test(t)) || '');

            // Job description container
            let description_html = sanitizeDescriptionHtml($('div.job-description, .description, [data-qa="job-description"]').first());
            const description_text = jsonld.description_text || htmlToText(description_html);

            const item = {
                url: request.url,
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
                _source: 'reed.co.uk',
                _fetchedAt: new Date().toISOString(),
                _from: 'detail',
            };
            await Dataset.pushData(item);
            jobCount++;
        }
    }
});

await crawler.run(initialUrls.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
log.info(`Done. Scraped: ${jobCount}`);

await Actor.exit();

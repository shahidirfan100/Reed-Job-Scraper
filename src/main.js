import crypto from 'node:crypto';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

await Actor.init();

const input = await Actor.getInput() ?? {};
const {
    keyword: keywordRaw = '',
    location: locationRaw = '',
    posted_date: postedDateRaw = 'anytime',
    results_wanted: resultsWantedRaw = 20,
    max_pages: maxPagesRaw = 50,
    startUrl,
    url,
    startUrls,
} = input;

const normalizeInputString = (value) => typeof value === 'string' ? value.trim() : '';
const keyword = normalizeInputString(keywordRaw);
const location = normalizeInputString(locationRaw);
const postedDate = normalizeInputString(postedDateRaw);
const VALID_POSTED_DATES = new Set(['anytime', 'today', 'last3days', 'last7days', 'last14days']);
if (postedDate && !VALID_POSTED_DATES.has(postedDate)) {
    log.warning(`Unsupported posted_date "${postedDate}". Using "anytime".`);
}
const effectivePostedDate = VALID_POSTED_DATES.has(postedDate) ? postedDate : 'anytime';

const toPositiveInteger = (value, fallback) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(1, Math.floor(numericValue)) : fallback;
};
const RESULTS_WANTED = toPositiveInteger(resultsWantedRaw, Number.MAX_SAFE_INTEGER);
const MAX_PAGES = toPositiveInteger(maxPagesRaw, 50);

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const RATE_LIMIT_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const TEMPORARY_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
]);
const DETAIL_CONCURRENCY = 2;
const DETAIL_RATE_LIMIT_DISABLE_THRESHOLD = 3;
const REQUEST_TIMEOUT_MS = 30000;
const REED_BFF_URL = 'https://api.reed.co.uk/api-bff-jobseeker-jobs/';
const BLOCK_PAGE_MARKERS = [
    'cf-chl',
    'cloudflare',
    'captcha',
    'access denied',
    'just a moment',
    'verify you are human',
];

const sanitizeRecord = (record) => {
    const cleaned = {};
    for (const [key, value] of Object.entries(record)) {
        if (value !== null && value !== undefined && value !== '') {
            cleaned[key] = value;
        }
    }
    return cleaned;
};

const slugify = (value) => (value ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildStartUrl = (kw, loc, date) => {
    if (!kw && !loc) {
        const target = new URL('https://www.reed.co.uk/jobs');
        if (date && date !== 'anytime') {
            if (date === 'today') target.searchParams.set('dateCreatedOffSet', 'today');
            else if (date === 'last3days') target.searchParams.set('dateCreatedOffSet', 'lastthree');
            else if (date === 'last7days') target.searchParams.set('dateCreatedOffSet', 'lastseven');
            else if (date === 'last14days') target.searchParams.set('dateCreatedOffSet', 'lastfourteen');
            else target.searchParams.set('dateCreatedOffSet', date);
        }
        return target.href;
    }

    const keywordSlug = slugify(kw);
    const locationSlug = slugify(loc);
    if (!keywordSlug) return 'https://www.reed.co.uk/jobs';
    if (!locationSlug) return `https://www.reed.co.uk/jobs/${keywordSlug}-jobs`;
    return `https://www.reed.co.uk/jobs/${keywordSlug}-jobs-in-${locationSlug}`;
};

const normalizeUrl = (value) => {
    const candidate = normalizeInputString(value);
    if (!candidate) return null;

    try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            log.warning('Skipped source URL with an unsupported protocol.');
            return null;
        }
        return parsed.href;
    } catch {
        log.warning('Skipped malformed source URL.');
        return null;
    }
};

const normalizeInputUrls = ({ userStartUrls, userStartUrl, userUrl, fallbackUrl }) => {
    const candidates = [];

    if (Array.isArray(userStartUrls)) {
        for (const item of userStartUrls) {
            if (typeof item === 'string') candidates.push(item);
            else if (item && typeof item.url === 'string') candidates.push(item.url);
        }
    }
    if (typeof userStartUrl === 'string') candidates.push(userStartUrl);
    if (typeof userUrl === 'string') candidates.push(userUrl);
    if (!candidates.length) candidates.push(fallbackUrl);

    return [...new Set(candidates.map(normalizeUrl).filter(Boolean))];
};

const buildPagedUrl = (baseUrl, pageNo) => {
    const target = new URL(baseUrl);
    if (pageNo > 1) target.searchParams.set('pageno', String(pageNo));
    else target.searchParams.delete('pageno');
    return target.href;
};

const parseJsonCandidate = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const extractSearchResults = (parsed) => {
    const searchResults = parsed?.props?.pageProps?.searchResults
        ?? parsed?.pageProps?.searchResults
        ?? parsed?.searchResults
        ?? null;
    if (!searchResults || typeof searchResults !== 'object') return null;
    return {
        count: Number(searchResults.count) || null,
        jobs: Array.isArray(searchResults.jobs) ? searchResults.jobs : [],
    };
};

const parseStructuredPayload = (html) => {
    if (!html || typeof html !== 'string') return null;

    const candidates = [];

    const nextDataTagMatch = html.match(/<script[^>]*\bid=(["'])__NEXT_DATA__\1[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataTagMatch?.[2]) candidates.push(nextDataTagMatch[2]);

    const nextDataAssignmentMatch = html.match(/__NEXT_DATA__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i);
    if (nextDataAssignmentMatch?.[1]) candidates.push(nextDataAssignmentMatch[1]);

    for (const candidate of candidates) {
        const parsed = parseJsonCandidate(candidate);
        const extracted = extractSearchResults(parsed);
        if (extracted) return extracted;
    }

    return null;
};

const isLikelyBlockPage = (html) => {
    if (!html || typeof html !== 'string') return false;
    const lowered = html.toLowerCase();
    return BLOCK_PAGE_MARKERS.some((marker) => lowered.includes(marker));
};

class PayloadNotFoundError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'PayloadNotFoundError';
        this.details = details;
    }
};

const getErrorStatus = (error) => error?.details?.statusCode ?? error?.status ?? error?.statusCode ?? null;
const shouldBackoff = (error) => RATE_LIMIT_STATUSES.has(Number(getErrorStatus(error)));
const getRetryAfterMs = (response) => {
    const retryAfter = response?.headers?.get?.('retry-after');
    if (!retryAfter) return null;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const retryAt = Date.parse(retryAfter);
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
};
const isRetryableError = (error) => {
    const status = Number(getErrorStatus(error));
    if (Number.isFinite(status)) {
        return RATE_LIMIT_STATUSES.has(status) || (status >= 500 && status < 600);
    }
    if (error instanceof PayloadNotFoundError) return Boolean(error.details?.blocked);
    if (TEMPORARY_ERROR_CODES.has(error?.code) || ['AbortError', 'TimeoutError'].includes(error?.name)) return true;
    return /fetch failed|network|timeout|timed out|socket|connection reset/i.test(error?.message || '');
};
const getRetryDelay = ({ attempt, error, baseMs = 900, rateLimitBaseMs = 2500, capMs = 18000 }) => {
    const retryAfterMs = Number(error?.details?.retryAfterMs);
    if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return Math.min(capMs, retryAfterMs);

    const multiplier = shouldBackoff(error) ? rateLimitBaseMs : baseMs;
    return Math.min(capMs, multiplier * (2 ** (attempt - 1)) + randomInt(400, 1800));
};

const toAbsoluteJobUrl = (relativeOrAbsoluteUrl) => {
    if (!relativeOrAbsoluteUrl || typeof relativeOrAbsoluteUrl !== 'string') return null;
    if (relativeOrAbsoluteUrl.startsWith('http')) return relativeOrAbsoluteUrl;
    const cleaned = relativeOrAbsoluteUrl.startsWith('/') ? relativeOrAbsoluteUrl : `/${relativeOrAbsoluteUrl}`;
    if (cleaned.startsWith('/jobs/')) return `https://www.reed.co.uk${cleaned}`;
    return `https://www.reed.co.uk/jobs${cleaned}`;
};

const toAbsoluteProfileUrl = (profileUrl, ouUrl) => {
    if (ouUrl) return toAbsoluteJobUrl(ouUrl);
    if (!profileUrl || typeof profileUrl !== 'string') return null;
    if (profileUrl.startsWith('http')) return profileUrl;
    if (profileUrl.startsWith('/')) return toAbsoluteJobUrl(profileUrl);
    return `https://www.reed.co.uk/jobs/${profileUrl}`;
};

const toAbsoluteLogoUrl = (logoValue) => {
    if (!logoValue || typeof logoValue !== 'string') return null;
    if (logoValue.startsWith('http')) return logoValue;
    if (logoValue.startsWith('/')) return `https://resources.reed.co.uk${logoValue}`;
    return `https://resources.reed.co.uk/profileimages/logos/thumbs/${logoValue}`;
};

const getEmploymentType = (jobTypeCode) => {
    const map = {
        1: 'Permanent',
        2: 'Contract',
        3: 'Temporary',
        4: 'Part Time',
    };
    return map[jobTypeCode] || null;
};

const getCurrency = (salaryCurrencyId) => {
    const map = {
        1: 'GBP',
        2: 'EUR',
        3: 'USD',
    };
    return map[salaryCurrencyId] || null;
};

const formatSalary = (detail) => {
    if (detail.salaryDescription) return detail.salaryDescription;
    if (detail.salaryFrom && detail.salaryTo) return `£${detail.salaryFrom.toLocaleString()} - £${detail.salaryTo.toLocaleString()}`;
    if (detail.salaryFrom) return `£${detail.salaryFrom.toLocaleString()}`;
    if (detail.salaryTo) return `Up to £${detail.salaryTo.toLocaleString()}`;
    return null;
};

const textToHtml = (text) => {
    if (!text) return '';
    return text
        .split(/\n{2,}/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => `<p>${chunk}</p>`)
        .join('');
};

const decodeHtmlEntities = (value) => value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&pound;/gi, '£')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const htmlToText = (html) => {
    if (!html || typeof html !== 'string') return '';
    return decodeHtmlEntities(html)
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const extractScalarFields = (source, prefix = '') => {
    const out = {};
    if (!source || typeof source !== 'object') return out;

    for (const [key, value] of Object.entries(source)) {
        if (value === null || value === undefined || value === '') continue;

        const fieldName = `${prefix}${key}`;
        if (Array.isArray(value)) {
            if (value.length && value.every((entry) => typeof entry !== 'object')) {
                out[fieldName] = value;
            }
            continue;
        }

        if (typeof value === 'object') continue;
        out[fieldName] = value;
    }

    return out;
};

const createRecord = ({ job, pageNo, totalFound, keywordInput, locationInput, postedDateInput }) => {
    const detail = job?.jobDetail ?? {};
    const employerUrl = toAbsoluteProfileUrl(job?.profileUrl, job?.ouUrl);
    const logoUrl = toAbsoluteLogoUrl(job?.logoImage);

    const core = {
        url: toAbsoluteJobUrl(job?.url),
        jobId: detail.jobId ? String(detail.jobId) : null,
        title: detail.jobTitle || null,
        company: detail.ouName || job?.profileName || null,
        employerId: job?.profileUrl || null,
        employerUrl,
        logoUrl,
        location: detail.displayLocationName || null,
        countyLocation: detail.countyLocation || null,
        salary: formatSalary(detail),
        salaryMin: detail.salaryFrom ?? null,
        salaryMax: detail.salaryTo ?? null,
        currency: getCurrency(detail.salaryCurrencyId) || 'GBP',
        salaryType: detail.salaryType || null,
        datePosted: detail.dateCreated || detail.dateUpdated || null,
        dateUpdated: detail.dateUpdated || null,
        validThrough: detail.expiryDate || null,
        employmentType: getEmploymentType(detail.jobType),
        isFullTime: detail.isFullTime ?? null,
        isPartTime: detail.isPartTime ?? null,
        isFeatured: Boolean(detail.featuredLabel),
        isPromoted: detail.isPromoted ?? null,
        isTopJob: detail.isTopJob ?? null,
        isPriority: detail.isPriority ?? null,
        isTrainingJob: detail.isTrainingJob ?? null,
        isEarlyBird: detail.isEarlyBird ?? null,
        isEasyApply: detail.isEasyApply ?? null,
        remoteWorkingOption: detail.remoteWorkingOption || null,
        taxonomyLevel1: detail.taxonomyLevel1 || null,
        taxonomyLevel2: detail.taxonomyLevel2 || null,
        description_text: detail.jobDescription || null,
        description_html: textToHtml(detail.jobDescription || ''),
        page: pageNo,
        totalAvailableForSearch: totalFound,
        queryKeyword: keywordInput || null,
        queryLocation: locationInput || null,
        postedDateFilter: postedDateInput || null,
        _source: 'reed.co.uk',
        _fetchedAt: new Date().toISOString(),
    };

    const jobTopLevel = { ...job };
    delete jobTopLevel.jobDetail;

    const dynamicFields = {
        ...extractScalarFields(detail),
        ...extractScalarFields(jobTopLevel, 'job_'),
    };

    if (dynamicFields.job_url) dynamicFields.job_url = toAbsoluteJobUrl(dynamicFields.job_url);
    if (dynamicFields.job_ouUrl) dynamicFields.job_ouUrl = toAbsoluteJobUrl(dynamicFields.job_ouUrl);
    if (dynamicFields.job_profileUrl) {
        dynamicFields.job_profileUrl = toAbsoluteProfileUrl(dynamicFields.job_profileUrl, dynamicFields.job_ouUrl);
    }
    if (dynamicFields.job_logoImage) dynamicFields.job_logoImage = toAbsoluteLogoUrl(dynamicFields.job_logoImage);

    return sanitizeRecord({ ...dynamicFields, ...core });
};

const createDedupKey = (record) => {
    if (record.jobId) return `jobId:${record.jobId}`;
    if (record.url) return `url:${record.url}`;
    if (record.title || record.company || record.location) {
        return `fallback:${record.title || ''}|${record.company || ''}|${record.location || ''}|${record.datePosted || ''}`;
    }
    return null;
};

const buildDetailApiUrl = (jobId) => {
    const params = new URLSearchParams({
        includeGaTags: 'false',
        includeProfileDetails: 'false',
        includeSimilarSearches: 'false',
        includeSimilarJobs: 'false',
        includeRecommendedCourses: 'false',
        includeHiddenJobs: 'false',
        shortlistedJobsCount: '0',
    });
    return `${REED_BFF_URL}job/consolidated/${encodeURIComponent(jobId)}/anonymous/?${params}`;
};

const fetchJobDetailPayload = async ({ record, client, maxRetries = 2 }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
            const response = await client.fetch(buildDetailApiUrl(record.jobId), {
                signal: timeout,
                headers: {
                    'x-correlation-id': crypto.randomUUID(),
                    'x-correlation-source-id': 'web-jobseeker-jobs',
                    origin: 'https://www.reed.co.uk',
                    referer: record.url || 'https://www.reed.co.uk/jobs',
                },
            });
            const statusCode = Number(response?.status);
            if (!response || !Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
                throw new PayloadNotFoundError(`Detail API returned HTTP ${statusCode || 'unknown'}`, {
                    blocked: RATE_LIMIT_STATUSES.has(statusCode),
                    statusCode,
                    retryAfterMs: getRetryAfterMs(response),
                });
            }

            const text = await response.text();
            const data = parseJsonCandidate(text);
            const payload = data?.result?.jobDetails ?? null;

            if (!payload) {
                const blocked = isLikelyBlockPage(text);
                const message = blocked
                    ? `Detail API payload not found: likely anti-bot response (status ${response.status})`
                    : `Detail API payload not found (status ${response.status})`;
                throw new PayloadNotFoundError(message, {
                    blocked,
                    statusCode: response.status,
                    bodyLength: text.length,
                });
            }

            return payload;
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries || !isRetryableError(error)) break;

            const delay = getRetryDelay({
                attempt,
                error,
                baseMs: 700,
                rateLimitBaseMs: 1800,
                capMs: 6000,
            });
            await sleep(delay);
        }
    }

    throw lastError ?? new Error('Unknown detail fetch failure');
};

const detailStats = {
    success: 0,
    fallback: 0,
    rateLimited: 0,
    disabled: false,
};

const enrichRecordWithDetail = async ({ record, client }) => {
    if (!record.jobId || detailStats.disabled) {
        detailStats.fallback++;
        return sanitizeRecord({
            ...record,
            description_text: record.description_text || record.jobDescriptionSnippet,
            description_html: record.description_html || textToHtml(record.jobDescriptionSnippet || ''),
        });
    }

    try {
        await sleep(randomInt(220, 680));
        const detail = await fetchJobDetailPayload({ record, client });
        const descriptionHtml = typeof detail.description === 'string' ? detail.description.trim() : '';
        const descriptionText = htmlToText(descriptionHtml);
        detailStats.success++;

        return sanitizeRecord({
            ...record,
            description_text: descriptionText || record.description_text || record.jobDescriptionSnippet,
            description_html: descriptionHtml || record.description_html || textToHtml(record.jobDescriptionSnippet || ''),
        });
    } catch (error) {
        detailStats.fallback++;
        if (getErrorStatus(error) === 429) {
            detailStats.rateLimited++;
            if (detailStats.rateLimited >= DETAIL_RATE_LIMIT_DISABLE_THRESHOLD) {
                detailStats.disabled = true;
            }
        }
        return sanitizeRecord({
            ...record,
            description_text: record.description_text || record.jobDescriptionSnippet,
            description_html: record.description_html || textToHtml(record.jobDescriptionSnippet || ''),
        });
    }
};

const mapWithConcurrency = async (items, limit, mapper) => {
    const results = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex++;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    });

    await Promise.all(workers);
    return results;
};

const fetchPagePayload = async ({ targetUrl, client, pageNo, maxRetries = 4 }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
            const response = await client.fetch(targetUrl, { signal: timeout });
            const statusCode = Number(response?.status);
            if (!response || !Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
                throw new PayloadNotFoundError(`Search page returned HTTP ${statusCode || 'unknown'}`, {
                    blocked: RATE_LIMIT_STATUSES.has(statusCode),
                    statusCode,
                    retryAfterMs: getRetryAfterMs(response),
                });
            }

            const body = await response.text();
            const payload = parseStructuredPayload(body);
            if (!payload) {
                const blocked = isLikelyBlockPage(body);
                const message = blocked
                    ? `Structured payload not found: likely anti-bot page (status ${response.status})`
                    : `Structured payload not found (status ${response.status})`;
                throw new PayloadNotFoundError(message, {
                    blocked,
                    statusCode: response.status,
                    bodyLength: body.length,
                });
            }
            return payload;
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries || !isRetryableError(error)) break;

            const delay = getRetryDelay({ attempt, error });
            if (attempt === 1 || attempt === maxRetries - 1) {
                log.warning(`Search page ${pageNo} temporarily unavailable (${error.message}). Retrying ${attempt + 1}/${maxRetries} in ${Math.round(delay / 1000)}s.`);
            }
            await sleep(delay);
        }
    }

    throw lastError ?? new Error('Unknown fetch failure');
};

const hasExplicitStartUrl = Boolean(
    (typeof startUrl === 'string' && startUrl.trim())
    || (typeof url === 'string' && url.trim())
    || (Array.isArray(startUrls) && startUrls.some((item) => (
        (typeof item === 'string' && item.trim())
        || (item && typeof item.url === 'string' && item.url.trim())
    )))
);
const defaultStartUrl = buildStartUrl(keyword, location, effectivePostedDate);
const startUrlList = normalizeInputUrls({
    userStartUrls: startUrls,
    userStartUrl: startUrl,
    userUrl: url,
    fallbackUrl: defaultStartUrl,
});
if (!startUrlList.length) {
    throw new Error('No usable Reed source URL was provided.');
}

const queryKeyword = hasExplicitStartUrl ? '' : keyword;
const queryLocation = hasExplicitStartUrl ? '' : location;
const queryPostedDate = hasExplicitStartUrl ? '' : effectivePostedDate;

const client = new Impit({
    browser: 'chrome',
    ignoreTlsErrors: true,
});

if (hasExplicitStartUrl) {
    log.info(`Starting Reed URL scrape with ${startUrlList.length} source URL(s).`);
} else {
    log.info(`Starting Reed keyword search for "${keyword || 'all jobs'}"${location ? ` in "${location}"` : ''}.`);
}

let totalSaved = 0;
let duplicateCount = 0;
const seenKeys = new Set();

for (const sourceUrl of startUrlList) {
    if (totalSaved >= RESULTS_WANTED) break;

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        if (totalSaved >= RESULTS_WANTED) break;

        const pageUrl = buildPagedUrl(sourceUrl, pageNo);
        let payload;

        try {
            payload = await fetchPagePayload({ targetUrl: pageUrl, client, pageNo });
        } catch (error) {
            if (shouldBackoff(error) && pageNo > 1 && totalSaved > 0) {
                log.warning(`Stopped this source after repeated rate limits on page ${pageNo}. Saved ${totalSaved} record(s); try lowering requested results or enabling residential proxy for larger runs.`);
                break;
            }
            if (error instanceof PayloadNotFoundError && pageNo > 1 && totalSaved > 0) {
                log.warning(`Stopped this source at page ${pageNo} after repeated payload errors. Saved ${totalSaved} record(s).`);
                break;
            }
            log.warning(`Stopped one source due to repeated page errors: ${error.message}`);
            break;
        }

        const { jobs } = payload;
        if (!jobs.length) {
            if (pageNo === 1) log.warning('No records found for one source URL.');
            break;
        }

        const batch = [];
        for (const job of jobs) {
            if (totalSaved >= RESULTS_WANTED) break;

            const record = createRecord({
                job,
                pageNo,
                totalFound: payload.count,
                keywordInput: queryKeyword,
                locationInput: queryLocation,
                postedDateInput: queryPostedDate,
            });

            const dedupKey = createDedupKey(record);
            if (dedupKey && seenKeys.has(dedupKey)) {
                duplicateCount++;
                continue;
            }

            if (dedupKey) seenKeys.add(dedupKey);
            if (!record.url && !record.title) continue;

            batch.push(record);
            totalSaved++;
        }

        if (batch.length) {
            const enrichedBatch = await mapWithConcurrency(
                batch,
                DETAIL_CONCURRENCY,
                (record) => enrichRecordWithDetail({ record, client }),
            );
            await Actor.pushData(enrichedBatch);
        }

        log.info(`Page ${pageNo}: saved ${batch.length}; total ${totalSaved}.`);

        if (jobs.length === 0) break;
        if (payload.count && pageNo * jobs.length >= payload.count) break;
        await sleep(300 + Math.floor(Math.random() * 450));
    }
}

if (duplicateCount > 0) {
    log.info(`Skipped ${duplicateCount} duplicate record(s).`);
}
if (detailStats.success || detailStats.fallback) {
    log.info(`Description enrichment: ${detailStats.success} full, ${detailStats.fallback} fallback${detailStats.disabled ? ' (paused after rate limits)' : ''}.`);
}

log.info(`Run finished. Total records saved: ${totalSaved}.`);
await Actor.exit();

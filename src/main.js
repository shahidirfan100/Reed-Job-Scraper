import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';

await Actor.init();

const input = await Actor.getInput() ?? {};
const {
    keyword = '',
    location = '',
    posted_date = 'anytime',
    results_wanted: RESULTS_WANTED_RAW = 20,
    max_pages: MAX_PAGES_RAW = 50,
    startUrl,
    url,
    startUrls,
    proxyConfiguration,
} = input;

const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW)
    ? Math.max(1, +RESULTS_WANTED_RAW)
    : Number.MAX_SAFE_INTEGER;
const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW)
    ? Math.max(1, +MAX_PAGES_RAW)
    : 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    return [...new Set(candidates.map((entry) => entry?.trim()).filter(Boolean))];
};

const buildPagedUrl = (baseUrl, pageNo) => {
    const target = new URL(baseUrl);
    if (pageNo > 1) target.searchParams.set('pageno', String(pageNo));
    else target.searchParams.delete('pageno');
    return target.href;
};

const parseStructuredPayload = (html) => {
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
    if (!match) return null;

    let parsed;
    try {
        parsed = JSON.parse(match[1]);
    } catch {
        return null;
    }

    const searchResults = parsed?.props?.pageProps?.searchResults;
    if (!searchResults) return null;

    return {
        count: Number(searchResults.count) || null,
        jobs: Array.isArray(searchResults.jobs) ? searchResults.jobs : [],
    };
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

const fetchPagePayload = async ({ targetUrl, proxyConf, maxRetries = 3 }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const proxyUrl = proxyConf ? await proxyConf.newUrl() : undefined;
            const response = await gotScraping({
                url: targetUrl,
                proxyUrl,
                timeout: { request: 45000 },
                headers: {
                    'Accept-Language': 'en-GB,en;q=0.9,en-US;q=0.8',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                },
            });

            const payload = parseStructuredPayload(response.body);
            if (!payload) throw new Error('Structured payload not found');
            return payload;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) await sleep(1000 * (2 ** (attempt - 1)));
        }
    }

    throw lastError ?? new Error('Unknown fetch failure');
};

const defaultStartUrl = buildStartUrl(keyword, location, posted_date);
const startUrlList = normalizeInputUrls({
    userStartUrls: startUrls,
    userStartUrl: startUrl,
    userUrl: url,
    fallbackUrl: defaultStartUrl,
});

const proxyConf = proxyConfiguration
    ? await Actor.createProxyConfiguration(proxyConfiguration)
    : undefined;

log.info(`Starting run with ${startUrlList.length} source URL(s).`);

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
            payload = await fetchPagePayload({ targetUrl: pageUrl, proxyConf });
        } catch (error) {
            log.warning(`Stopped one source due to repeated page errors: ${error.message}`);
            break;
        }

        const jobs = payload.jobs;
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
                keywordInput: keyword,
                locationInput: location,
                postedDateInput: posted_date,
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
            await Actor.pushData(batch);
        }

        log.info(`Processed page ${pageNo}. Added ${batch.length} record(s). Total saved: ${totalSaved}.`);

        if (jobs.length === 0) break;
        if (payload.count && pageNo * jobs.length >= payload.count) break;
    }
}

if (duplicateCount > 0) {
    log.info(`Skipped ${duplicateCount} duplicate record(s).`);
}

log.info(`Run finished. Total records saved: ${totalSaved}.`);
await Actor.exit();

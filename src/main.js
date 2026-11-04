import crypto from 'node:crypto';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

await Actor.init();

const SITE = 'https://www.reed.co.uk';
const BFF_URL = 'https://api.reed.co.uk/api-bff-jobseeker-jobs/';
const DEFAULT_KEYWORD = 'administrative assistant';
const PAGE_SIZE = 100;
const MAX_RESULTS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DETAIL_TIMEOUT_MS = 12_000;
const MAX_SEARCH_ATTEMPTS = 4;
const MAX_DETAIL_ATTEMPTS = 2;
const DETAIL_CONCURRENCY = 4;
const DETAIL_FAILURE_LIMIT = 4;

// Every profile below returned the search page and the detail payload during discovery.
const BROWSER_PROFILES = ['chrome', 'chrome151', 'chrome142', 'firefox158', 'firefox144', 'okhttp5', 'ios18'];

const POSTED_DATE_PARAMS = {
    anytime: null,
    today: 'today',
    last3days: 'lastthreedays',
    last7days: 'lastweek',
    last14days: 'lasttwoweeks',
};

const CURRENCY_BY_ID = { 1: 'GBP', 2: 'EUR', 3: 'USD' };
const SALARY_PERIOD_BY_ID = { 1: 'per hour', 2: 'per day', 5: 'per annum' };
const EMPLOYMENT_TYPE_BY_ID = { 1: 'Permanent', 2: 'Contract', 4: 'Temporary' };
const CHALLENGE_MARKERS = [
    'cf-mitigated',
    '_cf_chl_opt',
    'just a moment',
    'access denied',
    'pardon our interruption',
    'verify you are human',
];
const TEMPORARY_NETWORK_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
]);

class RequestError extends Error {
    constructor(message, { status = null, retryAfterMs = null, blocked = false, permanent = false } = {}) {
        super(message);
        this.name = 'RequestError';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
        this.blocked = blocked;
        this.permanent = permanent;
    }
}

class PayloadError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PayloadError';
    }
}

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const normalizeText = (value) => {
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

const toNumberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const toInteger = (value, fallback, min, max) => {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
};

const boolOrNull = (value) => (typeof value === 'boolean' ? value : null);

const decodeCodePoint = (code) => {
    try {
        return String.fromCodePoint(code);
    } catch {
        return '';
    }
};

const decodeEntities = (value) => String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&pound;/gi, '£')
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => decodeCodePoint(Number.parseInt(code, 16)));

const stripTags = (html) => decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const htmlToText = (html) => {
    if (!html || typeof html !== 'string') return '';
    return decodeEntities(html)
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const escapeHtml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const textToHtml = (text) => {
    if (!text) return '';
    return text
        .split(/\n{2,}/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => `<p>${escapeHtml(chunk)}</p>`)
        .join('');
};

const sanitizeRecord = (record) => {
    const cleaned = {};
    for (const [key, value] of Object.entries(record)) {
        if (value === null || value === undefined || value === '') continue;
        if (Array.isArray(value) && value.length === 0) continue;
        cleaned[key] = value;
    }
    return cleaned;
};

const slugify = (value) => String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const parseJson = (value) => {
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value.replace(/^\uFEFF/, '').trim());
    } catch {
        return null;
    }
};

const isChallengeBody = (body) => {
    if (!body || typeof body !== 'string') return false;
    const head = body.slice(0, 20_000).toLowerCase();
    return CHALLENGE_MARKERS.some((marker) => head.includes(marker));
};

const getRetryAfterMs = (response) => {
    const retryAfter = response?.headers?.get?.('retry-after');
    if (!retryAfter) return null;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const retryAt = Date.parse(retryAfter);
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
};

const isRetryable = (error) => {
    if (error instanceof RequestError) {
        if (error.permanent) return false;
        if (error.blocked) return true;
        if (error.status === null) return true;
        return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
    }
    if (error instanceof PayloadError) return true;
    if (TEMPORARY_NETWORK_CODES.has(error?.code) || ['AbortError', 'TimeoutError'].includes(error?.name)) return true;
    return /fetch failed|network|timeout|timed out|socket|connection reset/i.test(error?.message ?? '');
};

const getRetryDelay = (attempt, error) => {
    const retryAfterMs = Number(error?.retryAfterMs);
    if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return Math.min(20_000, Math.max(250, retryAfterMs));

    const base = error?.blocked ? 1500 : 700;
    return Math.min(15_000, base * (2 ** (attempt - 1)) + randomInt(250, 900));
};

const describeResponse = (response, body) => {
    const status = response?.status ?? 'unknown';
    const contentType = response?.headers?.get?.('content-type') ?? 'unknown';
    const parsed = parseJson(body);
    let jsonSummary = 'none';
    if (parsed && typeof parsed === 'object') {
        const keys = Object.keys(parsed).slice(0, 8).join(',');
        const errorCode = normalizeText(parsed.errorCode);
        const message = normalizeText(parsed.message).slice(0, 160);
        jsonSummary = `keys=${keys}${errorCode ? `, errorCode=${errorCode}` : ''}${message ? `, message=${message}` : ''}`;
    }
    return `status=${status}, content-type=${contentType}, bytes=${body?.length ?? 0}, challenge=${isChallengeBody(body)}, json=${jsonSummary}`;
};

const safeText = async (response) => {
    try {
        return await response.text();
    } catch {
        return '';
    }
};

const formatError = (error) => String(error?.message ?? error).replace(/\s+/g, ' ').trim().slice(0, 300);

const extractBalancedJson = (text, startIndex) => {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < text.length; index++) {
        const character = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }

        if (character === '"') inString = true;
        else if (character === '{') depth++;
        else if (character === '}') {
            depth--;
            if (depth === 0) return text.slice(startIndex, index + 1);
        }
    }

    return null;
};

const parseNextData = (html) => {
    if (!html || typeof html !== 'string') return null;

    const tagMatch = html.match(/<script[^>]*\bid=(["'])__NEXT_DATA__\1[^>]*>([\s\S]*?)<\/script>/i);
    if (tagMatch?.[2]) {
        const parsed = parseJson(tagMatch[2]);
        if (parsed) return parsed;
    }

    const assignmentMatch = html.match(/__NEXT_DATA__\s*=\s*\{/);
    if (assignmentMatch) {
        const startIndex = assignmentMatch.index + assignmentMatch[0].length - 1;
        const json = extractBalancedJson(html, startIndex);
        const parsed = parseJson(json);
        if (parsed) return parsed;
    }

    return null;
};

const extractTextNearMarker = (html, marker, windowSize = 700) => {
    const index = html.indexOf(`data-qa="${marker}"`);
    if (index === -1) return '';

    const window = html.slice(index, index + windowSize);
    const nextMarkerIndex = window.indexOf('data-qa=', 10);
    return stripTags(nextMarkerIndex === -1 ? window : window.slice(0, nextMarkerIndex));
};

const parseCardsFromHtml = (html) => {
    if (!html || typeof html !== 'string') return [];

    const cards = [];
    const cardPattern = /<article\b[^>]*data-qa="job-card"[^>]*>[\s\S]*?<\/article>/gi;

    for (const match of html.matchAll(cardPattern)) {
        const article = match[0];
        const idMatch = article.match(/data-id="job(\d+)"/i) ?? article.match(/\/jobs\/[^"?]+\/(\d{5,})/i);
        const anchorTag = article.match(/<a\b[^>]*data-qa="job-card-title"[^>]*>/i)?.[0] ?? '';
        const href = anchorTag.match(/href="([^"]+)"/i)?.[1] ?? '';
        const titleHtml = article.match(/<a\b[^>]*data-qa="job-card-title"[^>]*>([\s\S]*?)<\/a>/i)?.[1];
        const title = stripTags(titleHtml) || anchorTag.match(/title="([^"]*)"/i)?.[1] || '';
        const postedBy = extractTextNearMarker(article, 'job-posted-by').replace(/^posted by\s+/i, '');
        const salary = extractTextNearMarker(article, 'job-metadata-salary');
        const location = extractTextNearMarker(article, 'job-metadata-location');

        if (!href && !idMatch?.[1]) continue;

        cards.push({
            url: href,
            profileName: postedBy,
            jobDetail: {
                jobId: idMatch?.[1] ? Number(idMatch[1]) : null,
                jobTitle: title,
                ouName: postedBy,
                displayLocationName: location,
                salaryDescription: salary,
            },
        });
    }

    return cards;
};

const extractSearchPayload = (html) => {
    const data = parseNextData(html);
    const pageProps = data?.props?.pageProps ?? data?.pageProps ?? null;

    if (pageProps?.notFoundReason) {
        return { jobs: [], count: 0, source: 'not-found', notFoundReason: pageProps.notFoundReason };
    }

    const searchResults = pageProps?.searchResults ?? data?.searchResults ?? null;
    if (searchResults && typeof searchResults === 'object') {
        let jobs = [];
        if (Array.isArray(searchResults.jobs)) jobs = searchResults.jobs;
        else if (Array.isArray(searchResults.results)) jobs = searchResults.results;

        return {
            jobs,
            count: toNumberOrNull(searchResults.count),
            source: 'next-data',
        };
    }

    const cards = parseCardsFromHtml(html);
    if (cards.length) return { jobs: cards, count: null, source: 'html-cards' };

    return null;
};

const buildSearchUrl = ({ keyword, location, postedDate, page }) => {
    const keywordSlug = slugify(keyword);
    const locationSlug = slugify(location);
    let path = '/jobs';

    if (keywordSlug && locationSlug) path = `/jobs/${keywordSlug}-jobs-in-${locationSlug}`;
    else if (keywordSlug) path = `/jobs/${keywordSlug}-jobs`;
    else if (locationSlug) path = `/jobs/jobs-in-${locationSlug}`;

    const url = new URL(path, SITE);
    if (keyword) url.searchParams.set('keywords', keyword);
    if (location) url.searchParams.set('locationName', location);

    const dateParam = POSTED_DATE_PARAMS[postedDate];
    if (dateParam) url.searchParams.set('datecreatedoffset', dateParam);

    url.searchParams.set('take', String(PAGE_SIZE));
    if (page > 1) url.searchParams.set('pageno', String(page));
    return url.href;
};

const prepareSearchUrl = (sourceUrl, page) => {
    const url = new URL(sourceUrl, SITE);
    url.searchParams.set('take', String(PAGE_SIZE));
    if (page > 1) url.searchParams.set('pageno', String(page));
    else url.searchParams.delete('pageno');
    return url.href;
};

const extractJobId = (value) => {
    try {
        const { pathname } = new URL(value, SITE);
        if (/\/p\d+\/?$/.test(pathname)) return null;
        const match = pathname.match(/^\/jobs\/(?:job\/)?(\d{5,})\/?$/)
            ?? pathname.match(/^\/jobs\/[^/]+\/(\d{5,})\/?$/);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
};

const toJobUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    try {
        const url = new URL(value, SITE);
        if (url.hostname !== 'www.reed.co.uk') return null;
        url.search = '';
        url.hash = '';
        return url.href;
    } catch {
        return null;
    }
};

const toEmployerUrl = (ouUrl, profileUrl, profileId) => {
    if (ouUrl) {
        const normalized = toJobUrl(ouUrl);
        if (normalized) return normalized;
    }
    const slug = slugify(profileUrl);
    if (slug && profileId) return `${SITE}/jobs/${slug}/p${profileId}`;
    return null;
};

const toLogoUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    if (value.startsWith('http')) return value;
    if (value.startsWith('/')) return `https://resources.reed.co.uk${value}`;
    return `https://resources.reed.co.uk/profileimages/logos/thumbs/${value}`;
};

const normalizeWorkingOption = (value) => {
    const normalized = String(value ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!normalized) return null;
    if (normalized.includes('remote')) return 'Remote';
    if (normalized.includes('hybrid')) return 'Hybrid';
    if (normalized.includes('onsite')) return 'On-site';
    return null;
};

const formatSalary = (from, to, period) => {
    if (from === null && to === null) return null;
    const suffix = period ? ` ${period}` : '';
    if (from !== null && to !== null) return `£${from.toLocaleString('en-GB')} - £${to.toLocaleString('en-GB')}${suffix}`;
    if (from !== null) return `£${from.toLocaleString('en-GB')}${suffix}`;
    return `Up to £${to.toLocaleString('en-GB')}${suffix}`;
};

const createBaseRecord = ({ job, page, total, context }) => {
    const card = job?.jobDetail ?? {};
    const jobId = card.jobId ? String(card.jobId) : extractJobId(job?.url);
    const url = toJobUrl(job?.url) ?? (jobId ? `${SITE}/jobs/job/${jobId}` : null);
    const salaryFrom = toNumberOrNull(card.salaryFrom);
    const salaryTo = toNumberOrNull(card.salaryTo);
    const salaryPeriod = SALARY_PERIOD_BY_ID[card.salaryType] ?? null;
    const snippet = normalizeText(card.jobDescriptionSnippet);

    return sanitizeRecord({
        url,
        jobId,
        title: normalizeText(card.jobTitle) || null,
        company: normalizeText(card.ouName) || normalizeText(job?.profileName) || null,
        employerId: card.profileId ? String(card.profileId) : normalizeText(job?.profileUrl) || null,
        employerUrl: toEmployerUrl(job?.ouUrl, job?.profileUrl, card.profileId),
        logoUrl: toLogoUrl(job?.logoImage),
        location: normalizeText(card.displayLocationName) || null,
        countyLocation: normalizeText(card.countyLocation) || null,
        salary: normalizeText(card.salaryDescription) || formatSalary(salaryFrom, salaryTo, salaryPeriod),
        salaryMin: salaryFrom,
        salaryMax: salaryTo,
        salaryPeriod,
        salaryType: salaryPeriod,
        currency: CURRENCY_BY_ID[card.salaryCurrencyId] ?? 'GBP',
        datePosted: card.dateCreated || card.displayDate || null,
        dateUpdated: card.dateUpdated || null,
        validThrough: card.expiryDate || null,
        employmentType: EMPLOYMENT_TYPE_BY_ID[card.jobType] ?? null,
        isFullTime: boolOrNull(card.isFullTime),
        isPartTime: boolOrNull(card.isPartTime),
        isFeatured: boolOrNull(card.featuredLabel),
        isPromoted: boolOrNull(card.isPromoted),
        isPriority: boolOrNull(card.isPriority),
        isTopJob: boolOrNull(card.isTopJob),
        isTrainingJob: boolOrNull(card.isTrainingJob),
        isEasyApply: boolOrNull(card.isEasyApply),
        remoteWorkingOption: normalizeWorkingOption(card.workingOption),
        taxonomyLevel1: normalizeText(card.taxonomyLevel1) || null,
        taxonomyLevel2: normalizeText(card.taxonomyLevel2) || null,
        description_text: snippet || null,
        description_html: snippet ? textToHtml(snippet) : null,
        page,
        totalAvailableForSearch: total ?? null,
        queryKeyword: context.keyword || null,
        queryLocation: context.location || null,
        postedDateFilter: context.postedDate || null,
        _source: 'reed.co.uk',
        _fetchedAt: new Date().toISOString(),
    });
};

const mergeDetail = (base, detail) => {
    const location = detail?.jobLocation ?? {};
    const salary = detail?.jobSalary ?? {};
    const owner = detail?.jobOwner ?? {};
    const contract = detail?.jobContractType ?? {};
    const hours = detail?.jobEmploymentHours ?? {};
    const sector = detail?.jobSector ?? {};
    const descriptionHtml = typeof detail?.description === 'string' ? detail.description.trim() : '';
    const skills = Array.isArray(detail?.jobSkills)
        ? detail.jobSkills.map((skill) => normalizeText(skill?.name)).filter(Boolean)
        : [];
    const breadcrumbs = Array.isArray(detail?.breadcrumbs)
        ? detail.breadcrumbs.map((crumb) => normalizeText(crumb)).filter(Boolean)
        : [];

    return sanitizeRecord({
        ...base,
        title: normalizeText(detail?.title) || base.title,
        company: normalizeText(owner.profileName) || normalizeText(owner.ouName) || base.company,
        employerId: owner.profileId ? String(owner.profileId) : base.employerId,
        employerUrl: toEmployerUrl(null, owner.profileUrl, owner.profileId) ?? base.employerUrl,
        companyProfileUrl: owner.companyProfileUrl ? `${SITE}/company-profile/${owner.companyProfileUrl}` : base.companyProfileUrl,
        logoUrl: toLogoUrl(owner.profileLogoImage) ?? toLogoUrl(owner.ouLogoImage) ?? base.logoUrl,
        location: normalizeText(location.locationName) || base.location,
        town: normalizeText(location.townName) || base.town,
        countyLocation: normalizeText(location.countyName) || base.countyLocation,
        region: normalizeText(location.regionName) || base.region,
        country: normalizeText(location.countryName) || base.country,
        countryCode: normalizeText(location.countryCode) || base.countryCode,
        postcode: normalizeText(location.postCode) || base.postcode,
        isRemote: boolOrNull(location.isRemoteJob) ?? base.isRemote,
        salary: normalizeText(salary.displaySalary) || base.salary,
        salaryMin: toNumberOrNull(salary.from) ?? base.salaryMin,
        salaryMax: toNumberOrNull(salary.to) ?? base.salaryMax,
        salaryPeriod: normalizeText(salary.type?.name) || base.salaryPeriod,
        salaryAnnualMin: toNumberOrNull(salary.fromPerAnnum) ?? base.salaryAnnualMin,
        salaryAnnualMax: toNumberOrNull(salary.toPerAnnum) ?? base.salaryAnnualMax,
        isSalaryNegotiable: boolOrNull(salary.isNegotiable) ?? base.isSalaryNegotiable,
        currency: CURRENCY_BY_ID[salary.currencyId] ?? base.currency,
        salaryType: normalizeText(salary.type?.name) || base.salaryType,
        datePosted: detail?.createdDate || base.datePosted,
        dateUpdated: detail?.updatedDate || base.dateUpdated,
        validThrough: detail?.expiryDate || base.validThrough,
        employmentType: normalizeText(contract.name) || base.employmentType,
        isFullTime: boolOrNull(hours.isFullTime) ?? base.isFullTime,
        isPartTime: boolOrNull(hours.isPartTime) ?? base.isPartTime,
        isPermanent: boolOrNull(detail?.isPermanent) ?? base.isPermanent,
        isContract: boolOrNull(detail?.isContract) ?? base.isContract,
        isTemporary: boolOrNull(detail?.isTemp) ?? base.isTemporary,
        isAgency: boolOrNull(detail?.isAgency) ?? base.isAgency,
        isEmployer: boolOrNull(detail?.isEmployer) ?? base.isEmployer,
        isReed: boolOrNull(detail?.isReed) ?? base.isReed,
        isGraduate: boolOrNull(detail?.isGraduate) ?? base.isGraduate,
        isEasyApply: boolOrNull(detail?.isEasyApply) ?? base.isEasyApply,
        isFeatured: boolOrNull(detail?.isFeatured) ?? base.isFeatured,
        isPromoted: boolOrNull(detail?.isPromoted) ?? base.isPromoted,
        isTrainingJob: boolOrNull(detail?.isTrainingJob) ?? base.isTrainingJob,
        requiresUkEligibility: boolOrNull(detail?.hasEligibilityToWorkInUk) ?? base.requiresUkEligibility,
        eligibilityRequirement: normalizeText(detail?.jobApplicationEligibilityRequirement) || base.eligibilityRequirement,
        remoteWorkingOption: normalizeWorkingOption(location.inferredJobLocationType)
            ?? normalizeWorkingOption(location.workingOption)
            ?? base.remoteWorkingOption,
        skills: skills.length ? skills : base.skills,
        sector: normalizeText(sector.name) || base.sector,
        sectorId: toNumberOrNull(sector.id) ?? base.sectorId,
        sectorParent: normalizeText(sector.parentName) || base.sectorParent,
        taxonomy: normalizeText(detail?.taxonomy) || base.taxonomy,
        breadcrumbs: breadcrumbs.length ? breadcrumbs : base.breadcrumbs,
        taxonomyLevel1: breadcrumbs[1] || base.taxonomyLevel1,
        taxonomyLevel2: breadcrumbs[2] || base.taxonomyLevel2,
        description_html: descriptionHtml || base.description_html,
        description_text: htmlToText(descriptionHtml) || base.description_text,
    });
};

const createDetailRecord = (detail, context, sourceUrl) => {
    const jobId = detail?.id ? String(detail.id) : null;
    const url = toJobUrl(sourceUrl) ?? (jobId ? `${SITE}/jobs/job/${jobId}` : null);
    const base = sanitizeRecord({
        url,
        jobId,
        page: 1,
        totalAvailableForSearch: 1,
        queryKeyword: context.keyword || null,
        queryLocation: context.location || null,
        postedDateFilter: context.postedDate || null,
        _source: 'reed.co.uk',
        _fetchedAt: new Date().toISOString(),
    });
    return mergeDetail(base, detail);
};

const buildDetailUrl = (jobId) => {
    const params = new URLSearchParams({
        includeGaTags: 'false',
        includeProfileDetails: 'false',
        includeSimilarSearches: 'false',
        includeSimilarJobs: 'false',
        includeRecommendedCourses: 'false',
        includeHiddenJobs: 'false',
        shortlistedJobsCount: '0',
    });
    return `${BFF_URL}job/consolidated/${encodeURIComponent(jobId)}/anonymous/?${params}`;
};

const buildDetailHeaders = (jobUrl) => ({
    accept: 'application/json, text/plain, */*',
    'x-correlation-id': crypto.randomUUID(),
    'x-correlation-source-id': 'web-jobseeker-jobs',
    origin: SITE,
    referer: jobUrl || `${SITE}/jobs`,
});

const rawInput = (await Actor.getInput()) ?? {};
const keywordInput = normalizeText(rawInput.keyword);
const locationInput = normalizeText(rawInput.location);
const postedDateInput = normalizeText(rawInput.posted_date) || 'anytime';
const maxPagesInput = toInteger(rawInput.max_pages, 20, 1, MAX_RESULTS / PAGE_SIZE);

const postedDate = Object.hasOwn(POSTED_DATE_PARAMS, postedDateInput) ? postedDateInput : 'anytime';
if (postedDateInput !== postedDate) {
    log.warning(`Unsupported posted_date "${postedDateInput}". Using "anytime".`);
}

const requestedResults = toInteger(rawInput.results_wanted, 20, 1, Number.MAX_SAFE_INTEGER);
const resultsWanted = Math.min(requestedResults, MAX_RESULTS);
if (requestedResults > MAX_RESULTS) {
    log.warning(`Reed exposes at most ${MAX_RESULTS} results for a search. Capping results_wanted at ${MAX_RESULTS}.`);
}

const startUrlCandidates = [];
const rawStartUrls = Array.isArray(rawInput.startUrls) ? rawInput.startUrls : [];
for (const item of rawStartUrls) {
    if (typeof item === 'string') startUrlCandidates.push(item);
    else if (item && typeof item.url === 'string') startUrlCandidates.push(item.url);
}
if (typeof rawInput.startUrl === 'string') startUrlCandidates.push(rawInput.startUrl);
if (typeof rawInput.url === 'string') startUrlCandidates.push(rawInput.url);

const normalizeSourceUrl = (value) => {
    const candidate = normalizeText(value);
    if (!candidate) return null;

    try {
        const url = new URL(candidate);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        if (url.hostname === 'reed.co.uk') url.hostname = 'www.reed.co.uk';
        if (url.hostname !== 'www.reed.co.uk') {
            log.warning('Skipped a source URL outside www.reed.co.uk.');
            return null;
        }
        url.hash = '';
        return url.href;
    } catch {
        log.warning('Skipped a malformed source URL.');
        return null;
    }
};

const sourceUrls = [...new Set(startUrlCandidates.map(normalizeSourceUrl).filter(Boolean))];
const hasExplicitSource = sourceUrls.length > 0;
const explicitKeyword = hasExplicitSource ? '' : keywordInput;
const explicitLocation = hasExplicitSource ? '' : locationInput;

let searchKeyword = explicitKeyword;
if (!hasExplicitSource && !explicitKeyword && !explicitLocation) searchKeyword = DEFAULT_KEYWORD;

const searchContext = {
    keyword: explicitKeyword || (hasExplicitSource ? '' : searchKeyword),
    location: explicitLocation,
    postedDate: hasExplicitSource ? '' : postedDate,
};

const proxyInput = rawInput.proxyConfiguration;
const proxyRequested = Boolean(proxyInput) && (
    proxyInput.useApifyProxy === true
    || (Array.isArray(proxyInput.proxyUrls) && proxyInput.proxyUrls.length > 0)
);
const proxyConfiguration = proxyRequested ? await Actor.createProxyConfiguration(proxyInput) : null;

const clientCache = new Map();
const unusableProfiles = new Set();
let activeProfileIndex = 0;

const createClient = async (profile) => {
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
    return new Impit({
        browser: profile,
        ...(proxyUrl ? { proxyUrl } : {}),
    });
};

const getClient = async () => {
    for (let offset = 0; offset < BROWSER_PROFILES.length; offset++) {
        const profile = BROWSER_PROFILES[(activeProfileIndex + offset) % BROWSER_PROFILES.length];
        if (unusableProfiles.has(profile)) continue;
        if (!clientCache.has(profile)) {
            try {
                clientCache.set(profile, await createClient(profile));
            } catch (error) {
                unusableProfiles.add(profile);
                log.warning(`Could not initialize the ${profile} request profile: ${formatError(error)}`);
                continue;
            }
        }
        return clientCache.get(profile);
    }
    throw new Error('No impit browser profile could be initialized.');
};

const rotateProfile = () => {
    const blockedProfile = BROWSER_PROFILES[activeProfileIndex];
    clientCache.delete(blockedProfile);
    activeProfileIndex = (activeProfileIndex + 1) % BROWSER_PROFILES.length;
    log.warning(`Switching from ${blockedProfile} to ${BROWSER_PROFILES[activeProfileIndex]} after a block.`);
};

const runWithRetries = async ({ label, attempts, operation }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const client = await getClient();
            return await operation(client, attempt);
        } catch (error) {
            lastError = error;
            if (!isRetryable(error) || attempt >= attempts) break;
            if (error instanceof RequestError && error.blocked) rotateProfile();
            const delay = getRetryDelay(attempt, error);
            log.warning(`${label}: ${formatError(error)}. Retrying in ${(delay / 1000).toFixed(1)}s (${attempt}/${attempts}).`);
            await sleep(delay);
        }
    }

    throw lastError ?? new Error(`${label} failed without a captured error.`);
};

const detailStats = {
    success: 0,
    pageFallback: 0,
    snippetFallback: 0,
    gone: 0,
    consecutiveFailures: 0,
    disabled: false,
};

const fetchSearchPage = async (url) => runWithRetries({
    label: `Search page ${url}`,
    attempts: MAX_SEARCH_ATTEMPTS,
    operation: async (client) => {
        const response = await client.fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        const status = Number(response.status);
        const body = await safeText(response);

        if (status === 404 || status === 410) {
            const payload = extractSearchPayload(body);
            if (payload) return payload;
            throw new RequestError(`Search page returned HTTP ${status}`, { status, permanent: true });
        }

        if (!response.ok) {
            throw new RequestError(`Search page returned HTTP ${status} (${describeResponse(response, body)})`, {
                status,
                blocked: status === 403 || status === 429 || isChallengeBody(body),
                retryAfterMs: getRetryAfterMs(response),
            });
        }

        const payload = extractSearchPayload(body);
        if (!payload) throw new PayloadError(`Search page had no job payload (${describeResponse(response, body)})`);
        return payload;
    },
});

const fetchJobPageDetail = async ({ jobId, jobUrl }) => runWithRetries({
    label: `Job page ${jobId}`,
    attempts: 2,
    operation: async (client) => {
        const url = toJobUrl(jobUrl) ?? `${SITE}/jobs/job/${jobId}`;
        const response = await client.fetch(url, { signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS) });
        if (response.status === 404 || response.status === 410) {
            throw new RequestError(`Job page returned HTTP ${response.status}`, {
                status: response.status,
                permanent: true,
            });
        }

        const body = await safeText(response);
        if (!response.ok) {
            throw new RequestError(`Job page returned HTTP ${response.status} (${describeResponse(response, body)})`, {
                status: response.status,
                blocked: response.status === 403 || response.status === 429 || isChallengeBody(body),
                retryAfterMs: getRetryAfterMs(response),
            });
        }

        const data = parseNextData(body);
        const detail = data?.props?.pageProps?.consolidatedJobDetails?.jobDetails;
        if (!detail) throw new PayloadError(`Job page had no detail payload (${describeResponse(response, body)})`);
        return detail;
    },
});

const fetchJobDetail = async ({ jobId, jobUrl }) => {
    try {
        const detail = await runWithRetries({
            label: `Job ${jobId}`,
            attempts: MAX_DETAIL_ATTEMPTS,
            operation: async (client) => {
                const response = await client.fetch(buildDetailUrl(jobId), {
                    headers: buildDetailHeaders(jobUrl),
                    signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
                });

                if (response.status === 404 || response.status === 410) {
                    throw new RequestError(`Job ${jobId} is no longer available`, {
                        status: response.status,
                        permanent: true,
                    });
                }

                const body = await safeText(response);
                if (!response.ok) {
                    throw new RequestError(`Detail endpoint returned HTTP ${response.status} (${describeResponse(response, body)})`, {
                        status: response.status,
                        blocked: response.status === 403 || response.status === 429 || isChallengeBody(body),
                        retryAfterMs: getRetryAfterMs(response),
                    });
                }

                const data = parseJson(body);
                const jobDetails = data?.result?.jobDetails;
                if (!jobDetails) {
                    throw new PayloadError(`Detail endpoint had no jobDetails (${describeResponse(response, body)})`);
                }
                return jobDetails;
            },
        });
        return { detail, source: 'detail' };
    } catch (error) {
        if (error instanceof RequestError && error.permanent) throw error;

        let pageError = null;
        const pageDetail = await fetchJobPageDetail({ jobId, jobUrl }).catch((failure) => {
            pageError = failure;
            return null;
        });
        if (pageDetail) return { detail: pageDetail, source: 'job-page' };
        if (pageError) log.warning(`Job ${jobId}: job page fallback failed: ${formatError(pageError)}`);
        throw error;
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

const enrichRecords = async (records) => {
    if (detailStats.disabled) {
        detailStats.snippetFallback += records.length;
        return records;
    }

    return mapWithConcurrency(records, DETAIL_CONCURRENCY, async (record) => {
        if (!record.jobId) return record;
        if (detailStats.disabled) {
            detailStats.snippetFallback++;
            return record;
        }

        try {
            const { detail, source } = await fetchJobDetail({ jobId: record.jobId, jobUrl: record.url });
            if (source === 'job-page') detailStats.pageFallback++;
            else detailStats.success++;
            detailStats.consecutiveFailures = 0;
            return mergeDetail(record, detail);
        } catch (error) {
            if (error instanceof RequestError && error.permanent) {
                detailStats.gone++;
                return record;
            }

            detailStats.consecutiveFailures++;
            if (detailStats.consecutiveFailures >= DETAIL_FAILURE_LIMIT && !detailStats.disabled) {
                detailStats.disabled = true;
                log.warning('Detail requests paused after repeated failures. Remaining jobs keep their search snippets.');
            }

            detailStats.snippetFallback++;
            return record;
        }
    });
};

const dedupKeys = new Set();
const createDedupKey = (record) => {
    if (record.jobId) return `jobId:${record.jobId}`;
    if (record.url) return `url:${record.url}`;
    if (record.title || record.company || record.location) {
        return `fallback:${record.title ?? ''}|${record.company ?? ''}|${record.location ?? ''}|${record.datePosted ?? ''}`;
    }
    return null;
};

let totalSaved = 0;
let duplicateCount = 0;
let successfulPages = 0;
let handledJobSources = 0;
let failedSources = 0;
let pagesProcessed = 0;

const saveRecords = async (records) => {
    if (!records.length) return 0;
    const enriched = await enrichRecords(records);
    await Actor.pushData(enriched);
    totalSaved += enriched.length;
    return enriched.length;
};

const processJobSource = async (sourceUrl) => {
    const jobId = extractJobId(sourceUrl);
    if (!jobId) return false;

    handledJobSources++;

    try {
        const { detail } = await fetchJobDetail({ jobId, jobUrl: sourceUrl });
        const record = createDetailRecord(detail, searchContext, sourceUrl);
        const dedupKey = createDedupKey(record);
        if (dedupKey && dedupKeys.has(dedupKey)) {
            duplicateCount++;
            return true;
        }
        if (dedupKey) dedupKeys.add(dedupKey);
        const saved = await saveRecords([record]);
        if (saved) log.info(`Saved job ${jobId}.`);
        return true;
    } catch (error) {
        if (error instanceof RequestError && error.permanent) {
            log.warning(`Job ${jobId} is no longer available: ${formatError(error)}`);
            return true;
        }
        log.warning(`Could not load job ${jobId}: ${formatError(error)}`);
        failedSources++;
        return true;
    }
};

const processSearchSource = async (sourceUrl) => {
    for (let page = 1; page <= maxPagesInput && totalSaved < resultsWanted; page++) {
        const pageUrl = prepareSearchUrl(sourceUrl, page);
        let payload;

        try {
            payload = await fetchSearchPage(pageUrl);
            successfulPages++;
            pagesProcessed++;
        } catch (error) {
            failedSources++;
            const scope = totalSaved > 0 ? `Stopped this source at page ${page}` : `Source failed at page ${page}`;
            log.warning(`${scope}: ${formatError(error)}`);
            break;
        }

        if (payload.notFoundReason) {
            log.info(`Search ended: ${payload.notFoundReason}.`);
            break;
        }

        if (!payload.jobs.length) {
            if (page === 1) log.info('No jobs matched this search.');
            break;
        }

        const batch = [];
        for (const job of payload.jobs) {
            if (totalSaved + batch.length >= resultsWanted) break;

            const record = createBaseRecord({
                job,
                page,
                total: payload.count,
                context: searchContext,
            });
            const dedupKey = createDedupKey(record);
            if (dedupKey && dedupKeys.has(dedupKey)) {
                duplicateCount++;
                continue;
            }
            if (!record.url && !record.title) continue;
            if (dedupKey) dedupKeys.add(dedupKey);
            batch.push(record);
        }

        const saved = await saveRecords(batch);
        if (saved) {
            log.info(`Page ${page}: saved ${saved}. Total ${totalSaved}/${resultsWanted}.`);
        }

        if (payload.count && page * PAGE_SIZE >= payload.count) break;
        if (page < maxPagesInput && totalSaved < resultsWanted) await sleep(randomInt(250, 600));
    }
};

if (proxyRequested) log.info('Proxy configuration enabled.');

if (hasExplicitSource) {
    log.info(`Starting Reed URL scrape with ${sourceUrls.length} source URL(s).`);
    for (const sourceUrl of sourceUrls) {
        if (totalSaved >= resultsWanted) break;
        const handledAsJob = await processJobSource(sourceUrl);
        if (!handledAsJob) await processSearchSource(sourceUrl);
    }
} else {
    log.info(`Starting Reed keyword search for "${searchKeyword || 'all jobs'}"${explicitLocation ? ` in "${explicitLocation}"` : ''}.`);
    const generatedUrl = buildSearchUrl({
        keyword: searchKeyword,
        location: explicitLocation,
        postedDate,
        page: 1,
    });
    await processSearchSource(generatedUrl);
}

if (successfulPages === 0 && handledJobSources === 0 && totalSaved === 0) {
    throw new Error(
        `Reed did not return a readable search page after ${failedSources} failed source(s). `
        + 'Check API_DISCOVERY.md and the run log before changing the request flow.',
    );
}

if (duplicateCount > 0) log.info(`Skipped ${duplicateCount} duplicate record(s).`);
if (detailStats.success || detailStats.pageFallback || detailStats.snippetFallback) {
    log.info(
        `Descriptions: ${detailStats.success} full, ${detailStats.pageFallback} from job pages, `
        + `${detailStats.snippetFallback} from search snippets${detailStats.disabled ? ' (detail requests paused)' : ''}.`,
    );
}
if (detailStats.gone > 0) log.info(`Skipped ${detailStats.gone} expired job detail(s).`);

log.info(`Run finished. Saved ${totalSaved} record(s) from ${pagesProcessed} page(s).`);
await Actor.exit();

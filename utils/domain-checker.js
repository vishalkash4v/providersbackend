const dns = require('dns').promises;
const net = require('net');

// ============================================================
// CACHE
// ============================================================

const cache = new Map();

const CACHE_TTL = 1000 * 60 * 30; // 30 minutes


// ============================================================
// WHOIS SERVERS
// ============================================================

const WHOIS_SERVERS = {
    com: 'whois.verisign-grs.com',
    net: 'whois.verisign-grs.com',
    org: 'whois.pir.org',
    io: 'whois.nic.io',
    co: 'whois.nic.co',
    in: 'whois.registry.in',
    site: 'whois.centralnic.com',
    ai: 'whois.nic.ai',
    app: 'whois.nic.google',
    dev: 'whois.nic.google',
    tech: 'whois.centralnic.com',
    hq: 'whois.identitydigital.services',
    me: 'whois.nic.me',
    tv: 'whois.nic.tv',
    cc: 'whois.verisign-grs.com',
    au: 'whois.auda.org.au'
};


// ============================================================
// TIMEOUT HELPER
// ============================================================

async function resolveWithTimeout(promise, timeoutMs) {

    let timeoutHandle;

    const timeoutPromise = new Promise((_, reject) => {

        timeoutHandle = setTimeout(() => {
            reject(new Error('Timeout'));
        }, timeoutMs);

    });

    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => {

        clearTimeout(timeoutHandle);

    });
}


// ============================================================
// WHOIS SERVER QUERY
// ============================================================

async function queryWhoisServer(
    domain,
    server,
    timeoutMs = 5000
) {

    return new Promise((resolve, reject) => {

        const client = new net.Socket();

        let data = '';
        let isDone = false;

        const cleanup = () => {

            if (!isDone) {

                isDone = true;

                client.destroy();

            }

        };

        const fallbackTimeout = setTimeout(() => {

            cleanup();

            reject(
                new Error('WHOIS overall timeout')
            );

        }, timeoutMs + 500);

        client.setTimeout(timeoutMs);

        client.on('timeout', () => {

            clearTimeout(fallbackTimeout);

            cleanup();

            reject(
                new Error('WHOIS socket timeout')
            );

        });

        client.on('error', (error) => {

            clearTimeout(fallbackTimeout);

            cleanup();

            reject(error);

        });

        client.on('data', (chunk) => {

            data += chunk.toString();

        });

        client.on('close', () => {

            clearTimeout(fallbackTimeout);

            cleanup();

            resolve(data);

        });

        client.connect(
            43,
            server,
            () => {

                client.write(
                    `${domain}\r\n`
                );

            }
        );

    });
}


// ============================================================
// WHOIS CHECK
// ============================================================

async function checkWhois(
    domain,
    retries = 1
) {

    const tld =
        domain.split('.').pop() || '';

    let server =
        WHOIS_SERVERS[tld] ||
        'whois.iana.org';

    for (
        let attempt = 0;
        attempt <= retries;
        attempt++
    ) {

        try {

            let data =
                await resolveWithTimeout(
                    queryWhoisServer(
                        domain,
                        server,
                        3000
                    ),
                    3500
                );

            if (
                !data ||
                !data.trim()
            ) {

                if (attempt === retries) {
                    return 'UNKNOWN';
                }

                await new Promise(
                    resolve =>
                        setTimeout(resolve, 1000)
                );

                continue;

            }

            // ====================================================
            // IANA REFERRAL
            // ====================================================

            if (
                server === 'whois.iana.org'
            ) {

                const match =
                    data.match(
                        /whois:\s+([a-zA-Z0-9\-.]+)/i
                    );

                if (
                    match &&
                    match[1]
                ) {

                    server = match[1];

                    data =
                        await resolveWithTimeout(
                            queryWhoisServer(
                                domain,
                                server,
                                3000
                            ),
                            3500
                        );

                } else {

                    return 'UNKNOWN';

                }

            }

            const lowerData =
                data.toLowerCase();

            // ====================================================
            // CENTRALNIC
            // ====================================================

            const isCentralNic = [
                'site',
                'online',
                'store',
                'tech'
            ].includes(tld);

            if (isCentralNic) {

                if (
                    lowerData.includes(
                        'not found'
                    )
                ) {

                    return 'AVAILABLE';

                }

                return 'TAKEN';

            }

            // ====================================================
            // AVAILABLE INDICATORS
            // ====================================================

            const availableIndicators = [
                'no match for',
                'not found',
                'no data found',
                'domain not found',
                'no object found'
            ];

            const isAvailable =
                availableIndicators.some(
                    indicator =>
                        lowerData.includes(
                            indicator
                        )
                );

            if (isAvailable) {

                return 'AVAILABLE';

            }

            // ====================================================
            // DEFAULT
            // ====================================================

            return 'TAKEN';

        } catch (error) {

            if (attempt === retries) {
                return 'UNKNOWN';
            }

            await new Promise(
                resolve =>
                    setTimeout(resolve, 1000)
            );

        }

    }

    return 'UNKNOWN';
}


// ============================================================
// RDAP CHECK
// ============================================================

async function checkRDAP(
    domain,
    retries = 2
) {

    const tld =
        domain.split('.').pop() || '';

    const rdapServers = {

        com:
            'https://rdap.verisign.com/com/v1/',

        net:
            'https://rdap.verisign.com/net/v1/',

        org:
            'https://rdap.publicinterestregistry.org/rdap/',

        io:
            'https://rdap.identitydigital.services/rdap/',

        co:
            'https://rdap.nic.co/',

        site:
            'https://rdap.centralnic.com/site/',

        online:
            'https://rdap.centralnic.com/online/',

        store:
            'https://rdap.centralnic.com/store/',

        tech:
            'https://rdap.centralnic.com/tech/'

    };

    const server =
        rdapServers[tld];

    if (!server) {
        return 'UNKNOWN';
    }

    for (
        let attempt = 0;
        attempt <= retries;
        attempt++
    ) {

        try {

            const controller =
                new AbortController();

            const timeoutId =
                setTimeout(
                    () => controller.abort(),
                    3000
                );

            const response =
                await fetch(
                    `${server}domain/${domain}`,
                    {
                        signal:
                            controller.signal,

                        headers: {
                            Accept:
                                'application/rdap+json'
                        }
                    }
                );

            clearTimeout(timeoutId);

            // ==================================================
            // REGISTERED
            // ==================================================

            if (
                response.status === 200
            ) {

                const data =
                    await response.json();

                if (
                    data.objectClassName ===
                    'domain'
                ) {

                    return 'TAKEN';

                }

                return 'TAKEN';

            }

            // ==================================================
            // NOT REGISTERED
            // ==================================================

            if (
                response.status === 404
            ) {

                return 'AVAILABLE';

            }

            return 'UNKNOWN';

        } catch (error) {

            if (attempt === retries) {
                return 'UNKNOWN';
            }

            await new Promise(
                resolve =>
                    setTimeout(resolve, 1000)
            );

        }

    }

    return 'UNKNOWN';
}


// ============================================================
// PREMIUM DOMAIN CHECK
// ============================================================

function isPremiumDomain(domain) {

    const parts =
        domain.split('.');

    const name =
        parts[0];

    // Short domains
    if (name.length <= 5) {
        return true;
    }

    // Known brands
    const KNOWN_BRANDS = [
        'google',
        'facebook',
        'amazon',
        'microsoft',
        'apple',
        'netflix'
    ];

    if (
        KNOWN_BRANDS.some(
            brand =>
                name === brand
        )
    ) {

        return true;

    }

    // Premium keywords
    const PREMIUM_KEYWORDS = [
        'fitness',
        'crypto',
        'loan',
        'insurance',
        'travel',
        'shop',
        'ai',
        'cloud'
    ];

    if (
        PREMIUM_KEYWORDS.some(
            keyword =>
                name === keyword ||
                name.includes(keyword)
        )
    ) {

        return true;

    }

    // Short alphabetic names
    if (
        /^[a-z]+$/.test(name) &&
        name.length <= 8
    ) {

        return true;

    }

    return false;
}


// ============================================================
// DNS RECORD CHECK
// ============================================================

async function checkRecords(
    domain,
    type
) {

    try {

        let records;

        if (type === 'A') {

            records =
                await resolveWithTimeout(
                    dns.resolve4(domain),
                    2000
                );

        } else if (type === 'AAAA') {

            records =
                await resolveWithTimeout(
                    dns.resolve6(domain),
                    2000
                );

        } else if (type === 'NS') {

            records =
                await resolveWithTimeout(
                    dns.resolveNs(domain),
                    2000
                );

        } else if (type === 'MX') {

            records =
                await resolveWithTimeout(
                    dns.resolveMx(domain),
                    2000
                );

        } else if (type === 'SOA') {

            records =
                await resolveWithTimeout(
                    dns.resolveSoa(domain),
                    2000
                );

        } else if (type === 'TXT') {

            records =
                await resolveWithTimeout(
                    dns.resolveTxt(domain),
                    2000
                );

        }

        return {
            hasRecords:
                !!(
                    records &&
                    (
                        Array.isArray(records)
                            ? records.length > 0
                            : true
                    )
                )
        };

    } catch (error) {

        return {
            hasRecords: false,
            code:
                error.code ||
                'UNKNOWN'
        };

    }
}


// ============================================================
// DOMAIN SCORE
// ============================================================

function scoreDomain(domain) {

    let score = 10;

    const parts =
        domain.split('.');

    const name =
        parts[0];

    const tld =
        parts.slice(1).join('.');

    // Length
    if (name.length > 10) {
        score -= 2;
    }

    // Numbers / hyphens
    if (/[0-9\-]/.test(name)) {
        score -= 2;
    }

    // Multiple words
    if (
        name.length > 8 ||
        name.includes('-')
    ) {
        score -= 1;
    }

    // Common TLDs
    const commonTlds = [
        'com',
        'net',
        'org',
        'io',
        'co',
        'ai',
        'app',
        'dev'
    ];

    if (
        !commonTlds.includes(tld)
    ) {
        score -= 1;
    }

    // Not .com
    if (tld !== 'com') {
        score -= 1;
    }

    return Math.max(
        3,
        Math.min(10, score)
    );
}


// ============================================================
// CHECK DOMAIN AVAILABILITY
// ============================================================

async function checkDomainAvailability(
    domain
) {

    const cleanDomain =
        domain.trim().toLowerCase();

    // ========================================================
    // CACHE
    // ========================================================

    const cached =
        cache.get(cleanDomain);

    if (
        cached &&
        Date.now() -
            cached.timestamp <
            CACHE_TTL
    ) {

        return cached.result;

    }

    // ========================================================
    // DEFAULT RESULT
    // ========================================================

    let result = {

        domain: cleanDomain,

        status: 'UNKNOWN',

        sources: {

            whois: 'UNKNOWN',

            rdap: 'UNKNOWN'

        },

        confidence: 'LOW',

        score:
            scoreDomain(cleanDomain)

    };

    // ========================================================
    // PREMIUM
    // ========================================================

    const premium =
        isPremiumDomain(
            cleanDomain
        );

    // ========================================================
    // WHOIS + RDAP
    // ========================================================

    const [
        whoisStatus,
        rdapStatus
    ] = await Promise.all([

        checkWhois(
            cleanDomain
        ),

        checkRDAP(
            cleanDomain
        )

    ]);

    result.sources.whois =
        whoisStatus;

    result.sources.rdap =
        rdapStatus;

    // ========================================================
    // TAKEN
    // ========================================================

    if (
        whoisStatus === 'TAKEN' ||
        rdapStatus === 'TAKEN'
    ) {

        result.status =
            'TAKEN';

        if (
            whoisStatus === 'TAKEN' &&
            rdapStatus === 'TAKEN'
        ) {

            result.confidence =
                'HIGH';

        } else if (
            whoisStatus === 'UNKNOWN' ||
            rdapStatus === 'UNKNOWN'
        ) {

            result.confidence =
                'MEDIUM';

        } else {

            result.confidence =
                'LOW';

        }

    }

    // ========================================================
    // AVAILABLE
    // ========================================================

    else if (
        whoisStatus === 'AVAILABLE' &&
        rdapStatus === 'AVAILABLE'
    ) {

        result.status =
            'AVAILABLE';

        result.confidence =
            'HIGH';

        if (premium) {

            result.premium =
                true;

            result.premiumType =
                'LIKELY';

            result.confidence =
                'MEDIUM';

        }

    }

    // ========================================================
    // UNKNOWN
    // ========================================================

    else {

        result.status =
            'UNKNOWN';

        if (
            whoisStatus === 'UNKNOWN' &&
            rdapStatus === 'UNKNOWN'
        ) {

            result.confidence =
                'LOW';

        } else {

            result.confidence =
                'MEDIUM';

        }

    }

    // ========================================================
    // CACHE
    // ========================================================

    if (
        result.status !== 'UNKNOWN'
    ) {

        cache.set(
            cleanDomain,
            {
                result,
                timestamp: Date.now()
            }
        );

    }

    console.log(
        `[DEBUG] Domain: ${cleanDomain} | ` +
        `WHOIS: ${whoisStatus} | ` +
        `RDAP: ${rdapStatus} | ` +
        `Final: ${result.status}`
    );

    return result;
}


// ============================================================
// GENERATE SUGGESTIONS
// ============================================================

function generateSuggestions(domain) {

    const parts =
        domain.split('.');

    if (parts.length < 2) {
        return [];
    }

    const name =
        parts[0].replace(
            /[^a-z0-9]/g,
            ''
        );

    const tld =
        parts.slice(1).join('.');

    const suggestions =
        new Set();

    const commonTlds = [
        'com',
        'in',
        'au',
        'site',
        'ai',
        'net',
        'org',
        'io',
        'co',
        'app',
        'dev',
        'tech',
        'hq'
    ];

    const prefixes = [
        'get',
        'my',
        'the',
        'try',
        'go',
        'use',
        'hello'
    ];

    const suffixes = [
        'app',
        'online',
        'tech',
        'hq',
        'hub',
        'labs',
        'pro',
        'ai',
        'ify'
    ];

    // TLD variations
    for (const ctld of commonTlds) {

        if (ctld !== tld) {

            suggestions.add(
                `${name}.${ctld}`
            );

        }

    }

    // Prefix variations
    for (const prefix of prefixes) {

        suggestions.add(
            `${prefix}${name}.${tld}`
        );

        suggestions.add(
            `${prefix}${name}.com`
        );

    }

    // Suffix variations
    for (const suffix of suffixes) {

        suggestions.add(
            `${name}${suffix}.${tld}`
        );

        suggestions.add(
            `${name}${suffix}.com`
        );

    }

    // Score
    const scoredSuggestions =
        Array.from(suggestions).map(
            domain => ({

                domain,

                score:
                    scoreDomain(domain)

            })
        );

    return scoredSuggestions
        .sort(
            (a, b) =>
                b.score - a.score
        )
        .slice(0, 25);
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    checkDomainAvailability,

    scoreDomain,

    generateSuggestions

};
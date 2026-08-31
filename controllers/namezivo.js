const {
    checkDomainAvailability,
    generateSuggestions,
} = require('../utils/domain-checker');

const DEFAULT_TLDS = [
    'com',
    'in',
    'au',
    'site',
    'ai',
    'net',
    'org',
    'io',
    'co'
];

const MAX_DOMAINS = 50;


// ============================================================
// HELPERS
// ============================================================

function parseListField(value) {

    if (value == null || value === '') {
        return [];
    }

    if (Array.isArray(value)) {

        return value
            .map(item =>
                String(item)
                    .trim()
                    .toLowerCase()
            )
            .filter(Boolean);

    }

    if (typeof value === 'string') {

        return value
            .split(/[\s,;\n\r\t]+/)
            .map(item =>
                item
                    .trim()
                    .toLowerCase()
            )
            .filter(Boolean);

    }

    return [
        String(value)
            .trim()
            .toLowerCase()
    ].filter(Boolean);
}


// ============================================================
// EXPAND KEYWORDS
// ============================================================

function expandDomains(domains, tlds) {

    const activeTlds =
        Array.isArray(tlds) && tlds.length
            ? tlds
                .map(tld =>
                    String(tld)
                        .replace(/^\./, '')
                        .trim()
                        .toLowerCase()
                )
                .filter(Boolean)
            : DEFAULT_TLDS;

    const expanded = [];

    for (const domain of domains) {

        const clean =
            String(domain)
                .trim()
                .toLowerCase();

        if (!clean) {
            continue;
        }

        // Example:
        // google
        // becomes google.com, google.io, etc.
        if (!clean.includes('.')) {

            activeTlds.forEach(tld => {

                expanded.push(
                    `${clean}.${tld}`
                );

            });

        } else {

            expanded.push(clean);

        }

    }

    return expanded;
}


// ============================================================
// CHECK DOMAINS IN BATCHES
// ============================================================

async function chunkedPromiseAll(
    items,
    batchSize,
    asyncFunction
) {

    const results = [];

    for (
        let i = 0;
        i < items.length;
        i += batchSize
    ) {

        const batch =
            items.slice(
                i,
                i + batchSize
            );

        const batchResults =
            await Promise.all(
                batch.map(item =>
                    asyncFunction(item)
                )
            );

        results.push(
            ...batchResults
        );
    }

    return results;
}


// ============================================================
// CHECK SINGLE OR BULK DOMAINS
// ============================================================
//
// POST /api/namezivo/domain/check
//
// FORM-DATA:
//
// domains = google.com,openai.com,joker.com
//
// OR:
//
// domains = google,openai,joker
// tlds = com,io,ai
//
// ============================================================

module.exports = {

    check: async (req, res) => {

        try {

            const rawDomains =
                req.body?.domains;

            const rawTlds =
                req.body?.tlds;


            // ====================================================
            // VALIDATION
            // ====================================================

            if (
                !rawDomains ||
                (
                    typeof rawDomains === 'string' &&
                    !rawDomains.trim()
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        'domains field is required'

                });

            }


            // ====================================================
            // PARSE DOMAINS
            // ====================================================

            const domainInputs =
                parseListField(
                    rawDomains
                );


            if (!domainInputs.length) {

                return res.status(400).json({

                    success: false,

                    message:
                        'At least one domain is required'

                });

            }


            // ====================================================
            // PARSE TLDS
            // ====================================================

            const tlds =
                rawTlds != null
                    ? parseListField(rawTlds)
                    : undefined;


            // ====================================================
            // EXPAND DOMAINS
            // ====================================================

            const expandedDomains =
                expandDomains(
                    domainInputs,
                    tlds
                );


            // ====================================================
            // REMOVE DUPLICATES
            // ====================================================

            const uniqueDomains = [
                ...new Set(
                    expandedDomains
                )
            ];


            // ====================================================
            // VALIDATION
            // ====================================================

            if (!uniqueDomains.length) {

                return res.status(400).json({

                    success: false,

                    message:
                        'No valid domains to check'

                });

            }


            if (
                uniqueDomains.length >
                MAX_DOMAINS
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        `Maximum ${MAX_DOMAINS} domains are allowed per request`

                });

            }


            // ====================================================
            // CHECK DOMAINS
            // ====================================================
            //
            // 5 domains at a time
            //
            // ====================================================

            const results =
                await chunkedPromiseAll(
                    uniqueDomains,
                    5,
                    checkDomainAvailability
                );


            // ====================================================
            // AVAILABLE
            // ====================================================

            const available =
                results.filter(
                    result =>
                        result.status ===
                        'AVAILABLE'
                );


            // ====================================================
            // NOT AVAILABLE
            // ====================================================

            const notAvailable =
                results.filter(
                    result =>
                        result.status ===
                        'TAKEN'
                );


            // ====================================================
            // UNKNOWN
            // ====================================================

            const unknown =
                results.filter(
                    result =>
                        result.status ===
                        'UNKNOWN'
                );


            // ====================================================
            // SUGGESTIONS
            // ====================================================

            const allSuggestions =
                new Map();

            const checkedSet =
                new Set(
                    uniqueDomains
                );


            for (const result of results) {

                if (
                    result.status !==
                    'AVAILABLE'
                ) {

                    const suggestions =
                        generateSuggestions(
                            result.domain
                        );

                    for (
                        const suggestion
                        of suggestions
                    ) {

                        if (
                            !checkedSet.has(
                                suggestion.domain
                            ) &&
                            !allSuggestions.has(
                                suggestion.domain
                            )
                        ) {

                            allSuggestions.set(
                                suggestion.domain,
                                suggestion.score
                            );

                        }

                    }

                }

            }


            // ====================================================
            // TOP SUGGESTIONS
            // ====================================================

            const topSuggestions =
                Array.from(
                    allSuggestions.entries()
                )
                    .sort(
                        (a, b) =>
                            b[1] - a[1]
                    )
                    .slice(0, 25)
                    .map(
                        ([domain]) =>
                            domain
                    );


            // ====================================================
            // CHECK SUGGESTIONS
            // ====================================================

            let suggestionResults = [];

            if (
                topSuggestions.length
            ) {

                suggestionResults =
                    await chunkedPromiseAll(
                        topSuggestions,
                        5,
                        checkDomainAvailability
                    );

                suggestionResults =
                    suggestionResults.filter(
                        result =>
                            result.status ===
                            'AVAILABLE'
                    );

            }


            // ====================================================
            // RESPONSE
            // ====================================================

            return res.status(200).json({

                success: true,

                message:
                    'Domains checked successfully',

                count:
                    uniqueDomains.length,

                data: {

                    available,

                    notAvailable,

                    unknown,

                    suggestions:
                        suggestionResults

                }

            });


        } catch (error) {

            console.error(
                'Domain Check Error:',
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    'Something went wrong',

                error:
                    error.message

            });

        }

    }

};
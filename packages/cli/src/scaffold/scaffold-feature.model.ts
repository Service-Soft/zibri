/**
 * A part of a generated project that it can be generated with or without.
 *
 * | | |
 * |---|---|
 * | `pages` | the home page, the assets explorer, the error page and the stylesheet they share |
 * | `mailingList` | the mailing list plugin, with its pages and its email |
 * | `metricsDashboard` | an example of a page with charts that run in the browser |
 * | `logEmail` | an example of an email built from data |
 */
export type ScaffoldFeature = 'pages' | 'mailingList' | 'metricsDashboard' | 'logEmail';

/**
 * Every feature a project can be generated with, in the order they are offered.
 */
export const SCAFFOLD_FEATURES: ScaffoldFeature[] = ['pages', 'mailingList', 'metricsDashboard', 'logEmail'];

/**
 * The features each feature is built on, which a project has whenever it has the feature.
 */
export const SCAFFOLD_FEATURE_REQUIREMENTS: Record<ScaffoldFeature, ScaffoldFeature[]> = {
    pages: [],
    // both render pages made of the components and the stylesheet the pages bring
    mailingList: ['pages'],
    metricsDashboard: ['pages'],
    logEmail: []
};

/**
 * The files each feature writes into a project, relative to it: a file, or a folder ending in "/".
 *
 * A file is written when the project has every feature naming it, so a file inside a folder of one
 * feature can belong to another as well. Every file no feature names is written whatever the features.
 */
export const SCAFFOLD_FEATURE_FILES: Record<ScaffoldFeature, string[]> = {
    pages: [
        'postcss.config.js',
        'tailwind.config.js',
        'assets/public/style.css',
        'assets/public/home.svg',
        'assets/public/assets.svg',
        'src/controllers/page.controller.ts',
        'src/__testing__/home-page.test.ts',
        'src/templates/components/',
        'src/templates/pages/home.tsx',
        'src/templates/pages/assets.tsx',
        'src/templates/pages/error.tsx'
    ],
    mailingList: [
        'src/templates/pages/mailing-list-preferences.tsx',
        'src/templates/pages/mailing-list-unsubscribe-confirmation.tsx',
        'src/templates/pages/subscribe-success.tsx',
        'src/templates/emails/mailing-list-subscribe-confirmation.tsx',
        'src/templates/email-components/mailing-list-base-email.tsx'
    ],
    metricsDashboard: [
        'src/tsx.d.ts',
        'src/templates/pages/metrics/',
        'src/templates/components/chart.tsx',
        'src/templates/components/stat-card.tsx',
        'assets/public/lib/',
        'assets/public/metrics.svg'
    ],
    logEmail: ['src/templates/emails/log.tsx']
};
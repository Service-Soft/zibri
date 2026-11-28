import { AnalyticsOperatingSystem } from './models/analytics-operating-system.enum';

/**
 * What the analytics read from a `User-Agent`, which they do not keep: whether it is a bot, and the rough operating
 * system.
 */
export abstract class AnalyticsUserAgentUtilities {
    // what a crawler, a link preview, a monitor, a headless browser or a script names itself by. A bot that runs the
    // script of a page and names itself like a browser is counted: nothing in a request tells it apart
    private static readonly BOT_REGEX: RegExp = new RegExp([
        'bot',
        'crawl',
        'spider',
        'slurp',
        'headless',
        'phantomjs',
        'puppeteer',
        'playwright',
        'selenium',
        'webdriver',
        'lighthouse',
        'pagespeed',
        'gtmetrix',
        'pingdom',
        'preview',
        'facebookexternalhit',
        'embedly',
        'curl',
        'wget',
        'python-',
        'java/',
        'go-http-client',
        'okhttp',
        'node-fetch',
        'axios',
        'undici',
        'postman',
        'httpclient',
        'libwww',
        // what the fetch of Node sends
        '^node$'
    ].join('|'), 'i');

    // in this order: an iPhone says it is "like Mac OS X", and Android runs on Linux
    private static readonly OPERATING_SYSTEMS: readonly (readonly [RegExp, AnalyticsOperatingSystem])[] = [
        [/iphone|ipad|ipod/i, AnalyticsOperatingSystem.IOS],
        [/android/i, AnalyticsOperatingSystem.ANDROID],
        [/windows/i, AnalyticsOperatingSystem.WINDOWS],
        [/macintosh|mac os x/i, AnalyticsOperatingSystem.MACOS],
        [/linux|x11|cros/i, AnalyticsOperatingSystem.LINUX]
    ];

    /**
     * Whether a `User-Agent` is that of a bot, a crawler, a headless browser or a script. A request without one is.
     * @param userAgent - The `User-Agent` of the request.
     * @returns True for a request the analytics drop.
     */
    static isBot(userAgent: string | undefined): boolean {
        return userAgent == undefined || userAgent.trim() === '' || this.BOT_REGEX.test(userAgent);
    }

    /**
     * Reads the rough operating system from a `User-Agent`.
     * @param userAgent - The `User-Agent` of the request.
     * @returns The operating system, `OTHER` when it names none of the others.
     */
    static resolveOperatingSystem(userAgent: string): AnalyticsOperatingSystem {
        return this.OPERATING_SYSTEMS.find(([regex]) => regex.test(userAgent))?.[1] ?? AnalyticsOperatingSystem.OTHER;
    }
}
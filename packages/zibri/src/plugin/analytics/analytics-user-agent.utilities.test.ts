import { describe, expect, it } from '@jest/globals';

import { AnalyticsUserAgentUtilities } from './analytics-user-agent.utilities';
import { AnalyticsOperatingSystem } from './models/analytics-operating-system.enum';

describe('AnalyticsUserAgentUtilities', () => {
    it('tells the operating system of the common browsers', () => {
        const userAgents: [string, AnalyticsOperatingSystem][] = [
            ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', AnalyticsOperatingSystem.WINDOWS],
            ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', AnalyticsOperatingSystem.MACOS],
            ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', AnalyticsOperatingSystem.LINUX],
            ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', AnalyticsOperatingSystem.LINUX],
            // says it is "like Mac OS X"
            ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', AnalyticsOperatingSystem.IOS],
            // runs on Linux
            ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', AnalyticsOperatingSystem.ANDROID],
            ['Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko)', AnalyticsOperatingSystem.OTHER]
        ];

        expect(userAgents.map(([userAgent]) => AnalyticsUserAgentUtilities.resolveOperatingSystem(userAgent)))
            .toEqual(userAgents.map(([, system]) => system));
    });

    it('tells bots, crawlers, headless browsers and scripts from browsers', () => {
        const bots: string[] = [
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
            'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
            'curl/8.5.0',
            'python-requests/2.32.3',
            'node',
            '',
            '   '
        ];

        expect(bots.filter(userAgent => !AnalyticsUserAgentUtilities.isBot(userAgent))).toEqual([]);
        expect(AnalyticsUserAgentUtilities.isBot(undefined)).toBe(true);
        expect(AnalyticsUserAgentUtilities.isBot(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        )).toBe(false);
    });
});
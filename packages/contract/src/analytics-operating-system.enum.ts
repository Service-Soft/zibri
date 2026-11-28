/**
 * The rough operating system a page view or event came from, read from its `User-Agent`, which is not kept.
 */
export enum AnalyticsOperatingSystem {
    /**
     * Windows.
     */
    WINDOWS = 'windows',
    /**
     * A Mac. An iPad asking for the desktop site says it is a Mac, and counts here.
     */
    MACOS = 'macos',
    /**
     * Linux, ChromeOS included.
     */
    LINUX = 'linux',
    /**
     * An iPhone or an iPad.
     */
    IOS = 'ios',
    /**
     * Android.
     */
    ANDROID = 'android',
    /**
     * Any other, or one the `User-Agent` does not name.
     */
    OTHER = 'other'
}
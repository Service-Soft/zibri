/**
 * How large each download of `streamed-download.entry.ts` is.
 */
export const STREAMED_DOWNLOAD_BYTES: number = 32 * 1024 * 1024;

/**
 * How many downloads `streamed-download.entry.ts` makes, one after another: the crash it checks for
 * depends on where the last chunk of a body lands, so one download may pass where several do not.
 */
export const STREAMED_DOWNLOADS: number = 5;
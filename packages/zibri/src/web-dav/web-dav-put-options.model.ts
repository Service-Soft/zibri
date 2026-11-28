import { WebDavPutIfMatch } from './web-dav-put-if-match.model';
import { WebDavPutIfNoneMatch } from './web-dav-put-if-none-match.model';
import { WebDavPutOverwrite } from './web-dav-put-overwrite.model';

/**
 * How a file is written to a WebDAV server: its content type, and which of the three conditions it is written
 * under. A put names exactly one of them.
 */
// one of three required rather than an unconditional put by default: replacing a file someone changed in the
// meantime is what a mirror has to rule out, and it says so once, here, rather than by forgetting an option
export type WebDavPutOptions = {
    /**
     * The media type the file is stored as, such as `application/pdf` or `text/calendar; charset=utf-8`.
     */
    contentType: string
} & (WebDavPutIfMatch | WebDavPutIfNoneMatch | WebDavPutOverwrite);
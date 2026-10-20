import { MimeType } from './mime-type.enum.ts';

/**
 * The known media types of json: `application/json`, and the formats written in it that carry the
 * `+json` suffix.
 */
export type JsonMimeType = MimeType.JSON | MimeType.JSON_LD | MimeType.JSON_SCIM;
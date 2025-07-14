import { Response } from 'express';

import { OmitStrict } from '../types';
import { KnownHeader } from './known-header.enum';
import { MimeType } from './mime-type.enum';

// eslint-disable-next-line jsdoc/require-jsdoc
type ValueTypeForHeader<T extends KnownHeader> = T extends KnownHeader.CONTENT_TYPE
    ? MimeType
    : T extends KnownHeader.CONTENT_LENGTH
        ? number
        : string;

/**
 * A http response. Based on the Response from express.
 */
export type HttpResponse = OmitStrict<Response, 'setHeader'> & {
    /**
     * Sets a http header.
     */
    setHeader: <T extends KnownHeader>(header: T, value: ValueTypeForHeader<T>) => HttpResponse
};
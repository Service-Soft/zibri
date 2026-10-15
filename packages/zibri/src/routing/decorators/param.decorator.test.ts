import { describe, expect, it } from '@jest/globals';

import { Param } from './param.decorator';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * What a string parameter can be declared with.
 */

describe('declaring a string parameter', () => {
    it('takes neither encryption nor hashing, while compiling', () => {
        class Handlers {
            byCode(
                // @ts-expect-error - a path parameter is read from the request, nothing encrypts it
                @Param.path('code', { type: 'string', encryption: true }) code: string,
                // @ts-expect-error - nor hashes it
                @Param.query('pin', { type: 'string', hash: true }) pin: string,
                // @ts-expect-error - a header neither
                @Param.header('x-api-key', { type: 'string', encryption: true }) apiKey: string,
                // @ts-expect-error - nor the items of a list read from the query
                @Param.query('codes', { type: 'array', items: { type: 'string', hash: true } }) codes: string[]
            ): string {
                return code + pin + apiKey + codes.join(',');
            }

            byShape(
                // @ts-expect-error - nor a string shape of a parameter that is one of several
                @Param.path('code', { type: 'oneOf', shapes: [{ type: 'string', encryption: true }, { type: 'number' }] }) code: string | number,
                // @ts-expect-error - nor the items of a list shape
                @Param.query('codes', { type: 'oneOf', shapes: [{ type: 'array', items: { type: 'string', hash: true } }, { type: 'number' }] }) codes: string[] | number
            ): string {
                return String(code) + String(codes);
            }
        }

        expect(MetadataUtilities.getRoutePathParams(Handlers, 'byCode')[0]).toEqual(expect.objectContaining({ name: 'code' }));
    });
});
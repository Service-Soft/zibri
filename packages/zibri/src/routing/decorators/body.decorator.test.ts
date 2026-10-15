import { describe, expect, it } from '@jest/globals';

import { BodyMetadata } from './body-metadata.model';
import { Body } from './body.decorator';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * What the shapes of a body can be declared with.
 */

describe('declaring the shapes of a body', () => {
    it('takes neither encryption nor hashing on a string, while compiling', () => {
        class Handlers {
            byCode(
                // @ts-expect-error - a body is read from the request, nothing encrypts it
                @Body.oneOf({ shapes: [{ type: 'string', encryption: true }, { type: 'number' }] }) code: string | number
            ): string {
                return String(code);
            }

            byCodes(
                // @ts-expect-error - nor hashes the items of a list in it
                @Body.oneOf({ shapes: [{ type: 'array', items: { type: 'string', hash: true } }, { type: 'number' }] }) codes: string[] | number
            ): string {
                return String(codes);
            }
        }

        const body: BodyMetadata | undefined = MetadataUtilities.getRouteBody(Handlers, 'byCode');
        expect(body?.type).toBeDefined();
    });
});
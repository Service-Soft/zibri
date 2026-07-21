import { describe, expect, it } from '@jest/globals';

import { startTestServer } from '../__testing__/test-server/start-test-server.function';

class NotAController {}

describe('MissingBaseRouteError', () => {
    it('is thrown when a controller is registered without a @Controller base route', async () => {
        await expect(startTestServer({ controllers: [NotAController] })).rejects.toThrow(
            'Could not find a base route for the controller "NotAController"'
        );
    }, 15000);
});
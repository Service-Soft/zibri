import { describe, expect, it, jest } from '@jest/globals';

import { DuplicateFrameworkCopyError } from './framework-copies';
import { GlobalRegistry } from './global-registry';
import { initDiContainer } from '../di/init-di-container.function';

/**
 * The second copy loaded below counts itself into a slot the whole realm shares, and nothing takes
 * it back out - so the duplicate test has to be the last one in this file. Jest gives every test
 * file its own realm, so it reaches no further than that. The constraint is the finding restated as
 * a property of the suite: what a copy of the framework does to a process cannot be undone from
 * inside it.
 */

describe('framework copies', () => {
    it('initializes while this is the only copy', () => {
        expect(() => initDiContainer()).not.toThrow();
    });

    it('refuses to initialize once a second copy is loaded', () => {
        // a fresh module registry evaluating the same files is what two copies in node_modules are:
        // one realm, two module instances, and two of everything those modules declare
        jest.resetModules();
        const secondCopy: typeof import('./global-registry') = jest.requireActual('./global-registry');

        // the registry the second copy keeps its injectables and entities in is not the one the
        // first copy reads, and neither of them can tell
        expect(secondCopy.GlobalRegistry).not.toBe(GlobalRegistry);
        expect(() => initDiContainer()).toThrow(DuplicateFrameworkCopyError);
        // exactly two: one evaluation per module registry, which is what makes the number the
        // number of copies rather than the number of times something was imported
        expect(() => initDiContainer()).toThrow(/^2 copies of zibri/);
        // and the message has to point at the install, because nothing in the application is wrong
        expect(() => initDiContainer()).toThrow(/npm ls zibri/);
    });
});
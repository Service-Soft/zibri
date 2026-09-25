/* eslint-disable typescript/no-var-requires */
/* eslint-disable typescript/no-require-imports */
import { describe, expect, it } from '@jest/globals';
import { clusterModulePaths } from 'zibri-testing';

import { ZibriApplication } from './application';

/**
 * Which copy of the framework a cluster instance gets.
 *
 * An instance is a plain node process, so a bare `zibri` in it resolves through `node_modules` to
 * the built package - while the options module it boots from reaches the framework however its own
 * imports say, which in this repository is the source tree beside it. That is two copies in one
 * process, and the framework refuses the second one by design (05 D7), so every cluster suite fails
 * at boot rather than at what it asserts.
 *
 * Nothing container-free can start an instance, so this covers the half that decides the outcome:
 * what the parent hands over is the copy the parent is using.
 */

describe('the module paths handed to a cluster instance', () => {

    it('names the copy of the framework this process loaded', () => {
        const paths: Record<string, string> = clusterModulePaths();

        const resolved: string | undefined = paths['zibri'];
        expect(resolved).toBeDefined();
        if (resolved == undefined) {
            throw new Error('nothing was resolved for zibri');
        }

        // identity rather than a path comparison: two files can hold the same class and still be
        // two classes, and being the same class is the whole question.
        const loaded: { ZibriApplication: unknown } = require(resolved) as { ZibriApplication: unknown };
        expect(loaded.ZibriApplication).toBe(ZibriApplication);
    });

    it('names the copy of the harness this process loaded', () => {
        // the harness too, because it declares ClusterMark: an entity is identified by its class, so
        // a second copy would leave the instance writing rows the parent cannot read back.
        const paths: Record<string, string> = clusterModulePaths();

        const resolved: string | undefined = paths['zibri-testing'];
        expect(resolved).toBeDefined();
        if (resolved == undefined) {
            throw new Error('nothing was resolved for zibri-testing');
        }

        const loaded: { clusterModulePaths: unknown } = require(resolved) as { clusterModulePaths: unknown };
        expect(loaded.clusterModulePaths).toBe(clusterModulePaths);
    });
});
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clusterModulePaths, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { ZibriApplication } from './application.ts';
import { FsUtilities } from '../utilities/fs.utilities.ts';
import { TypeScriptLoaderUtilities } from '../utilities/typescript-loader/typescript-loader.utilities.ts';

/**
 * Which copy of the framework a cluster instance gets.
 *
 * An instance is a plain node process, so a bare `zibri` in it resolves through `node_modules` to
 * the built package - while the options module it boots from reaches the framework however its own
 * imports say, which in this repository is the source tree beside it. That is two copies in one
 * process, and the framework refuses the second one by design (05 D7), so every cluster suite fails
 * at boot rather than at what it asserts.
 *
 * Both halves: what the parent hands over is the copy the parent is using, and an instance - booted
 * on a data source of its own, so no container is needed - runs on exactly that, in every thread.
 */

describe('the module paths handed to a cluster instance', () => {

    it('names the copy of the framework this process loaded', async () => {
        const paths: Record<string, string> = clusterModulePaths();

        const resolved: string | undefined = paths['zibri'];
        expect(resolved).toBeDefined();
        if (resolved == undefined) {
            throw new Error('nothing was resolved for zibri');
        }

        // identity rather than a path comparison: two files can hold the same class and still be
        // two classes, and being the same class is the whole question.
        const loaded: { ZibriApplication: unknown } = await import(pathToFileURL(resolved).href) as {
            // eslint-disable-next-line jsdoc-js/require-jsdoc
            ZibriApplication: unknown
        };
        expect(loaded.ZibriApplication).toBe(ZibriApplication);
    });

    it('names the copy of the harness this process loaded', async () => {
        // the harness too, because it declares ClusterMark: an entity is identified by its class, so
        // a second copy would leave the instance writing rows the parent cannot read back.
        const paths: Record<string, string> = clusterModulePaths();

        const resolved: string | undefined = paths['zibri-testing'];
        expect(resolved).toBeDefined();
        if (resolved == undefined) {
            throw new Error('nothing was resolved for zibri-testing');
        }

        const loaded: { clusterModulePaths: unknown } = await import(pathToFileURL(resolved).href) as {
            // eslint-disable-next-line jsdoc-js/require-jsdoc
            clusterModulePaths: unknown
        };
        expect(loaded.clusterModulePaths).toBe(clusterModulePaths);
    });

    it('names the TypeScript loader of the copy of the framework this process loaded', async () => {
        // the instance registers it before anything else, from the very files the parent runs - a
        // loader from the build would compile the sources with whatever was built last
        const loaded: { TypeScriptLoaderUtilities: unknown } = await import(
            pathToFileURL(TypeScriptLoaderUtilities.getModuleFile()).href
        ) as {
            // eslint-disable-next-line jsdoc-js/require-jsdoc
            TypeScriptLoaderUtilities: unknown
        };
        expect(loaded.TypeScriptLoaderUtilities).toBe(TypeScriptLoaderUtilities);
    });
});

describe('a cluster instance', () => {
    let cluster: StartedTestCluster | undefined;

    /**
     * The files the shared packages should resolve to inside an instance: the ones this process runs.
     */
    const expected: string = [clusterModulePaths()['zibri'], clusterModulePaths()['zibri-testing']]
        .map(file => pathToFileURL(file ?? '').href)
        .join(' ');

    beforeAll(async () => {
        cluster = await startTestCluster({
            instanceOptions: FsUtilities.getPath(import.meta.dirname, '..', '__testing__', 'cluster', 'module-paths.instance-options.ts'),
            instances: 1
        });
    }, 60_000);

    afterAll(async () => {
        await cluster?.shutdown();
    }, 30_000);

    /**
     * The running cluster.
     * @returns The cluster beforeAll started.
     * @throws When it did not start.
     */
    function startedCluster(): StartedTestCluster {
        if (cluster == undefined) {
            throw new Error('the cluster did not start');
        }
        return cluster;
    }

    it('boots from TypeScript, on the copies of the shared packages this process runs', async () => {
        const res: Response = await fetch(`${startedCluster().instanceAt(0).baseUrl}/cluster-module-paths/instance`);

        expect(res.status).toBe(200);
        expect((await res.text()).replaceAll('"', '')).toBe(expected);
    });

    it('runs a thread job on the same copies, in a thread that never ran the entry', async () => {
        const res: Response = await fetch(`${startedCluster().instanceAt(0).baseUrl}/cluster-module-paths/thread`, { method: 'POST' });

        expect(res.status).toBe(200);
        expect((await res.text()).replaceAll('"', '')).toBe(expected);
    }, 30_000);
});

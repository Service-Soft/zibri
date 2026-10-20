import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryDataSource,
    defaultTestProviders,
    resolveApplicationOptions,
    StartedTestServer,
    startTestServer } from 'zibri-testing';

import { ZibriApplicationOptions } from './application-options.model.ts';
import { Controller } from '../routing/decorators/controller.decorator.ts';
import { Get } from '../routing/decorators/get.decorator.ts';

/**
 * Testing an application by building it from the options it ships with.
 *
 * The shape a consumer is in: the controllers, entities, plugins and providers are declared once,
 * the entry point builds an application from them, and a test builds another one from the same
 * thing. What the test names beside it replaces that key and leaves the rest of the application
 * alone - which is what makes the server under test the application rather than something assembled
 * to resemble it.
 */

// allowOrphan on both, because this file declares two controllers and each application below uses
// one of them: an undeclared controller is otherwise refused at boot, which is the rule these two
// are exempt from rather than a rule this file is testing.
@Controller('/shipped', { allowOrphan: true, versions: 'all' })
class ShippedController {

    @Get('/')
    get(): { from: string } {
        return { from: 'the application' };
    }
}

@Controller('/replacement', { allowOrphan: true, versions: 'all' })
class ReplacementController {

    @Get('/')
    get(): { from: string } {
        return { from: 'the test' };
    }
}

// one class for the whole file: each call builds a new one, and a data source that is declared and
// never deployed is refused by name - so a second class would fail the first test's application
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource();

/**
 * What an application exports for its entry point and its tests to share.
 */
const applicationOptions: ZibriApplicationOptions = {
    name: 'shipped-application',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    controllers: [ShippedController],
    websocketControllers: [],
    defaultAuth: 'public',
    dataSources: [dataSourceClass],
    providers: defaultTestProviders
};

describe('a test server built from an application\'s own options', () => {

    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('serves what the application declares', async () => {
        server = await startTestServer({ application: applicationOptions });
        const baseUrl: string = await server.start();

        const res: Response = await fetch(`${baseUrl}/shipped`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ from: 'the application' });
    }, 15000);

    it('replaces the key the test names and inherits every other one', async () => {
        // the whole point of the precedence: naming the controllers says nothing about the version,
        // the data source or the auth posture, so an application that declares fifty things and a
        // test that is about one of them stay one line apart.
        server = await startTestServer({
            application: applicationOptions,
            controllers: [ReplacementController]
        });
        const baseUrl: string = await server.start();

        const replaced: Response = await fetch(`${baseUrl}/replacement`);
        expect(replaced.status).toBe(200);
        expect(await replaced.json()).toEqual({ from: 'the test' });

        // the controller it replaced is gone rather than added to, so a test naming one controller
        // gets one controller
        const shipped: Response = await fetch(`${baseUrl}/shipped`);
        expect(shipped.status).toBe(404);
    }, 15000);

    it('inherits the auth posture the application chose', async () => {
        // the key worth covering over http rather than against the merge: a test that silently got
        // 'public' where the application says 'requireLogin' would pass while exercising an
        // application nobody deploys - and every endpoint it touches would answer for the wrong
        // reason.
        server = await startTestServer({
            application: { ...applicationOptions, defaultAuth: 'requireLogin' }
        });
        const baseUrl: string = await server.start();

        const res: Response = await fetch(`${baseUrl}/shipped`);

        expect(res.status).toBe(401);
    }, 15000);

    it('takes what neither the call nor the application names from the harness', () => {
        const resolved: ZibriApplicationOptions = resolveApplicationOptions(
            { application: { ...applicationOptions, version: '2.1.0' }, controllers: [ReplacementController] },
            { name: 'harness', dataSources: () => [], providers: [] }
        );

        // the call wins, then the application, then the harness
        expect(resolved.controllers).toEqual([ReplacementController]);
        expect(resolved.name).toBe('shipped-application');
        expect(resolved.version).toBe('2.1.0');
        expect(resolved.baseUrl).toBe('http://localhost:3000');
        // named by neither, so the harness answers - and the application's own data sources survive
        expect(resolved.websocketControllers).toEqual([]);
        expect(resolved.dataSources).toEqual([dataSourceClass]);
    });

    it('treats an override that came out undefined as one nobody named', () => {
        // a test building its overrides from a variable is the ordinary case, and a spread would
        // read an undefined one as "boot without this" - which for `dataSources` is an application
        // that cannot store anything and for `defaultAuth` is one that stops asking who is calling.
        const resolved: ZibriApplicationOptions = resolveApplicationOptions(
            { application: applicationOptions, controllers: undefined, dataSources: undefined },
            { name: 'harness', dataSources: () => [], providers: [] }
        );

        expect(resolved.controllers).toEqual([ShippedController]);
        expect(resolved.dataSources).toEqual([dataSourceClass]);
    });

    it('starts without an application at all', async () => {
        // the harness's own defaults still stand: an application with no controllers on an in
        // process data source is what a test with nothing to point at gets.
        server = await startTestServer({ dataSources: [dataSourceClass] });

        await expect(server.start()).resolves.toMatch(/^http:\/\//);
    }, 15000);
});
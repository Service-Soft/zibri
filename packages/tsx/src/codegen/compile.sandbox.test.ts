import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compile, CompileResult } from './compile.ts';
import { collectTsxFiles } from '../__testing__/sandbox.helper.ts';
import { collectClientGlobalAliasesFromSource } from '../semantics/client-packages.ts';
import { parseTemplate, syntaxErrorsOf } from '../semantics/symbols.ts';

const templatesDir: string = join(import.meta.dirname, '..', '..', '..', 'sandbox', 'src', 'templates');

describe('compile against real sandbox templates', () => {
    const files: string[] = collectTsxFiles(templatesDir);

    it.each(files.map(f => [f.split('/templates/')[1], f] as const))(
        'emits a valid module for %s',
        (_name, file) => {
            const result: CompileResult = compile(readFileSync(file, 'utf8'));
            expect(result.diagnostics).toEqual([]);
            expect(result.code).toBeDefined();
            expect(result.componentName).toBeTruthy();
            // Re-parsing the emitted module with our own parser validates its syntax.
            expect(syntaxErrorsOf(parseTemplate(result.code ?? ''))).toEqual([]);
            // `?client` packages must never appear as server imports.
            expect(result.code).not.toContain('?client');
        }
    );

    it.each(files.map(f => [f.split('/templates/')[1], f] as const))(
        'binds every renamed ?client import used by the client script of %s',
        (_name, file) => {
            const source: string = readFileSync(file, 'utf8');
            const clientCode: string = compile(source).client?.code ?? '';
            for (const alias of collectClientGlobalAliasesFromSource(source)) {
                if (!clientCode.includes(alias.local)) {
                    continue;
                }
                // The browser only knows the global, so the local name must be bound to it.
                expect(clientCode).toContain(`const ${alias.local} = ${alias.global};`);
            }
        }
    );

    it.each(files.map(f => [f.split('/templates/')[1], f] as const))(
        'wires every function prop of %s from the server render to the client factory',
        (_name, file) => {
            const result: CompileResult = compile(readFileSync(file, 'utf8'));
            for (const site of result.client?.clientPropSites ?? []) {
                // The child gets a reference instead of the function...
                expect(result.code).toContain(`$ssr.markProp('${site.id}'`);
                // ...and this component's setup builds the function that reference points to.
                expect(result.client?.code).toContain(`${site.id}: (`);
            }
        }
    );

    it.each(files.map(f => [f.split('/templates/')[1], f] as const))(
        'keeps the client behavior of %s after filtering server-only code out',
        (_name, file) => {
            const result: CompileResult = compile(readFileSync(file, 'utf8'));
            const hasClientCode: boolean = (result.client?.handlerSites.length ?? 0) > 0
                || (result.client?.clientPropSites.length ?? 0) > 0
                || readFileSync(file, 'utf8').includes('onClient(');
            // Dropping unreachable statements must never drop the client behavior itself.
            expect(result.client?.code !== undefined).toBe(hasClientCode);
        }
    );

    it('finds the function props the sandbox actually passes between components', () => {
        // Guards the checks above against passing simply because nothing was collected.
        const sites: [string, string][] = files.flatMap(file => (compile(readFileSync(file, 'utf8')).client?.clientPropSites ?? [])
            .map(site => [file.split('/templates/')[1], site.name] as [string, string]));

        expect(sites).toContainEqual(['pages/metrics/network-chart.tsx', 'updateChart']);
        // A chart config holds a tick `callback`, which serializing would silently drop - so the
        // whole config has to be built on the client.
        expect(sites).toContainEqual(['pages/metrics/network-chart.tsx', 'chartConfig']);
        expect(sites).toContainEqual(['pages/metrics/requests-per-second-chart.tsx', 'chartConfig']);
        expect(sites).toContainEqual(['pages/metrics/resource-usage-chart.tsx', 'chartConfig']);
        // ...while a config without one still travels as plain serialized data.
        expect(sites).not.toContainEqual(['pages/metrics/request-duration-chart.tsx', 'chartConfig']);
    });
});
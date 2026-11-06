import { Stats, statSync, utimesSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import zibriTsxTransformer from './index';

const TEMPLATE: string = 'export const Home = ({ title }) => <h1>{title}</h1>;';

describe('zibri-tsx jest transformer', () => {
    it('compiles a template to commonjs, as the webpack loader does by default', () => {
        const { code } = zibriTsxTransformer.process(TEMPLATE, '/app/src/templates/home.tsx');

        expect(code).toContain('exports.Home =');
        expect(code).toContain('function __render$Home($ssr, { title })');
    });

    // jest reads the map a transformer returns, so a failing assertion inside a rendered
    // template points at the template
    it('returns the source map of the module, naming the template', () => {
        const { map } = zibriTsxTransformer.process(TEMPLATE, '/app/src/templates/home.tsx');

        expect(map.sources).toEqual(['/app/src/templates/home.tsx']);
        expect(map.sourcesContent).toEqual([TEMPLATE]);
        expect(map.mappings.length).toBeGreaterThan(0);
    });

    it('throws for a template that does not compile, naming the file, line and code', () => {
        expect(() => zibriTsxTransformer.process('\nexport const Bad = async () => <div/>;', '/app/src/templates/bad.tsx'))
            .toThrow(/\/app\/src\/templates\/bad\.tsx:2:\d+ ZTSX002/);
    });

    it('compiles a template with a warning, and prints the warning naming the file, line and code', () => {
        const printed: string[] = [];
        const original: typeof console.warn = console.warn;
        console.warn = (message: unknown) => printed.push(String(message));
        try {
            const { code } = zibriTsxTransformer.process(
                '\nexport const Toggle = () => { let on = false; return <input type="checkbox" checked={on} onChange={() => { on = !on; }}/>; };',
                '/app/src/templates/toggle.tsx'
            );

            expect(code).toContain('exports.Toggle =');
            expect(printed).toEqual([expect.stringMatching(/\/app\/src\/templates\/toggle\.tsx:2:\d+ ZTSX016/)]);
        }
        finally {
            console.warn = original;
        }
    });

    it('caches a template under a key of its own source, path and configuration', () => {
        const key: string = zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/home.tsx', { configString: '{}' });

        expect(zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/home.tsx', { configString: '{}' })).toBe(key);
        expect(zibriTsxTransformer.getCacheKey(`${TEMPLATE} `, '/app/home.tsx', { configString: '{}' })).not.toBe(key);
        expect(zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/other.tsx', { configString: '{}' })).not.toBe(key);
        expect(zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/home.tsx', { configString: '{"a":1}' })).not.toBe(key);
    });

    // the version does not move while the compiler is worked on, so a test would keep rendering what
    // the compiler before the last build emitted
    it('caches a template under another key once the compiler was built again', () => {
        const compiler: string = path.join(__dirname, 'index.ts');
        const { atime, mtime }: Stats = statSync(compiler);
        const key: string = zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/home.tsx', { configString: '{}' });

        utimesSync(compiler, atime, new Date(mtime.getTime() + 1000));
        try {
            expect(zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/home.tsx', { configString: '{}' })).not.toBe(key);
        }
        finally {
            utimesSync(compiler, atime, mtime);
        }
    });
});
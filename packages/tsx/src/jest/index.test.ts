import { describe, expect, it } from '@jest/globals';

import zibriTsxTransformer from './index';

const TEMPLATE: string = 'export const Home = ({ title }) => <h1>{title}</h1>;';

describe('zibri-tsx jest transformer', () => {
    it('compiles a template to commonjs, as the webpack loader does by default', () => {
        const { code } = zibriTsxTransformer.process(TEMPLATE, '/app/src/templates/home.tsx');

        expect(code).toContain('exports.Home =');
        expect(code).toContain('function __render$Home($ssr, { title })');
    });

    it('throws for a template that does not compile, naming the file, line and code', () => {
        expect(() => zibriTsxTransformer.process('\nexport const Bad = async () => <div/>;', '/app/src/templates/bad.tsx'))
            .toThrow(/\/app\/src\/templates\/bad\.tsx:2:\d+ ZTSX002/);
    });

    it('caches a template under a key of its own source, path and configuration', () => {
        const key: string = zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/home.tsx', { configString: '{}' });

        expect(zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/home.tsx', { configString: '{}' })).toBe(key);
        expect(zibriTsxTransformer.getCacheKey(`${TEMPLATE} `, '/app/home.tsx', { configString: '{}' })).not.toBe(key);
        expect(zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/other.tsx', { configString: '{}' })).not.toBe(key);
        expect(zibriTsxTransformer.getCacheKey(TEMPLATE, '/app/home.tsx', { configString: '{"a":1}' })).not.toBe(key);
    });
});
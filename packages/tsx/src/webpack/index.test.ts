import { describe, expect, it } from '@jest/globals';

import zibriTsxLoader, { LoaderContext, LoaderOptions } from './index';

function contextFor(file: string, errors: Error[], options?: LoaderOptions): LoaderContext {
    return {
        resourcePath: file,
        emitError: (error: Error) => errors.push(error),
        getOptions: () => options ?? {}
    };
}

describe('zibri-tsx webpack loader', () => {
    it('emits commonjs by default, matching a bundled node app', () => {
        const errors: Error[] = [];
        const out: string = zibriTsxLoader.call(
            contextFor('/app/src/templates/home.tsx', errors),
            'export const Home = ({ title }) => <h1>{title}</h1>;'
        );
        expect(errors).toEqual([]);
        expect(out).toContain('exports.Home = Home;');
        expect(out).toContain('function __render$Home($ssr, { title })');
    });

    it('emits esm when asked to', () => {
        const errors: Error[] = [];
        const out: string = zibriTsxLoader.call(
            contextFor('/app/src/templates/home.tsx', errors, { module: 'esm' }),
            'export const Home = ({ title }) => <h1>{title}</h1>;'
        );
        expect(errors).toEqual([]);
        expect(out).toContain('export const Home = {');
    });

    it('falls back to commonjs when the loader context has no options', () => {
        const errors: Error[] = [];
        const out: string = zibriTsxLoader.call(
            { resourcePath: '/app/x.tsx', emitError: (error: Error) => errors.push(error) },
            'export const Home = () => <div/>;'
        );
        expect(out).toContain('exports.Home = Home;');
    });

    it('reports dialect violations with file, line and column', () => {
        const errors: Error[] = [];
        const out: string = zibriTsxLoader.call(
            contextFor('/app/src/templates/bad.tsx', errors),
            '\nexport const Bad = async () => <div/>;'
        );
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('/app/src/templates/bad.tsx:2:');
        expect(errors[0].message).toContain('ZTSX002');
        // Emitting a placeholder keeps the bundler going so it can report every failing file.
        expect(out).toBe('module.exports = undefined;');
    });

    it('emits an esm placeholder when a failing template is compiled as esm', () => {
        const errors: Error[] = [];
        const out: string = zibriTsxLoader.call(
            contextFor('/app/bad.tsx', errors, { module: 'esm' }),
            'export const Bad = async () => <div/>;'
        );
        expect(out).toBe('export default undefined;');
    });

    it('reports parse errors', () => {
        const errors: Error[] = [];
        zibriTsxLoader.call(contextFor('/app/x.tsx', errors), 'export const A = () => <div>oops;');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('/app/x.tsx:1:');
    });
});
import { describe, expect, it } from '@jest/globals';

import zibriTsxLoader, { LoaderContext, LoaderOptions } from './index';
import { SourceMap } from '../codegen/source-map';

/**
 * What the loader handed webpack.
 */
type Handed = {
    /**
     * The module.
     */
    code: string | undefined,
    /**
     * Its source map.
     */
    map: SourceMap | undefined
};

function contextFor(file: string, errors: Error[], handed: Handed, options?: LoaderOptions): LoaderContext {
    return {
        resourcePath: file,
        emitError: (error: Error) => errors.push(error),
        callback: (_error: Error | undefined, code: string, map?: SourceMap) => {
            handed.code = code;
            handed.map = map;
        },
        getOptions: () => options ?? {}
    };
}

describe('zibri-tsx webpack loader', () => {
    it('emits commonjs by default, matching a bundled node app', () => {
        const errors: Error[] = [];
        const handed: Handed = { code: undefined, map: undefined };
        zibriTsxLoader.call(
            contextFor('/app/src/templates/home.tsx', errors, handed),
            'export const Home = ({ title }) => <h1>{title}</h1>;'
        );
        expect(errors).toEqual([]);
        expect(handed.code).toContain('exports.Home =');
        expect(handed.code).toContain('function __render$Home($ssr, { title })');
    });

    // webpack composes the map a loader hands it into the bundle's, so a stack frame of a
    // template names the template rather than a line of the compiled module
    it('hands webpack the source map of the module, naming the template', () => {
        const handed: Handed = { code: undefined, map: undefined };
        zibriTsxLoader.call(
            contextFor('/app/src/templates/home.tsx', [], handed),
            'export const Home = ({ title }) => <h1>{title}</h1>;'
        );
        expect(handed.map?.sources).toEqual(['/app/src/templates/home.tsx']);
        expect(handed.map?.mappings.length).toBeGreaterThan(0);
    });

    it('emits esm when asked to', () => {
        const errors: Error[] = [];
        const handed: Handed = { code: undefined, map: undefined };
        zibriTsxLoader.call(
            contextFor('/app/src/templates/home.tsx', errors, handed, { module: 'esm' }),
            'export const Home = ({ title }) => <h1>{title}</h1>;'
        );
        expect(errors).toEqual([]);
        expect(handed.code).toContain('export const Home = {');
    });

    it('falls back to commonjs when the loader context has no options', () => {
        const handed: Handed = { code: undefined, map: undefined };
        zibriTsxLoader.call(
            { resourcePath: '/app/x.tsx', emitError: () => {}, callback: (_error, code) => handed.code = code },
            'export const Home = () => <div/>;'
        );
        expect(handed.code).toContain('exports.Home =');
    });

    it('reports dialect violations with file, line and column', () => {
        const errors: Error[] = [];
        const handed: Handed = { code: undefined, map: undefined };
        zibriTsxLoader.call(
            contextFor('/app/src/templates/bad.tsx', errors, handed),
            '\nexport const Bad = async () => <div/>;'
        );
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('/app/src/templates/bad.tsx:2:');
        expect(errors[0].message).toContain('ZTSX002');
        // Emitting a placeholder keeps the bundler going so it can report every failing file.
        expect(handed.code).toBe('module.exports = undefined;');
        expect(handed.map).toBeUndefined();
    });

    it('emits an esm placeholder when a failing template is compiled as esm', () => {
        const handed: Handed = { code: undefined, map: undefined };
        zibriTsxLoader.call(
            contextFor('/app/bad.tsx', [], handed, { module: 'esm' }),
            'export const Bad = async () => <div/>;'
        );
        expect(handed.code).toBe('export default undefined;');
    });

    it('reports a warning with file, line and column, and hands webpack the module', () => {
        const warnings: Error[] = [];
        const handed: Handed = { code: undefined, map: undefined };
        zibriTsxLoader.call(
            { ...contextFor('/app/src/templates/toggle.tsx', [], handed), emitWarning: (warning: Error) => warnings.push(warning) },
            '\nexport const Toggle = () => { let on = false; return <input type="checkbox" checked={on} onChange={() => { on = !on; }}/>; };'
        );

        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toContain('/app/src/templates/toggle.tsx:2:');
        expect(warnings[0].message).toContain('ZTSX016');
        expect(handed.code).toContain('exports.Toggle =');
    });

    it('reports parse errors', () => {
        const errors: Error[] = [];
        zibriTsxLoader.call(contextFor('/app/x.tsx', errors, { code: undefined, map: undefined }), 'export const A = () => <div>oops;');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('/app/x.tsx:1:');
    });
});
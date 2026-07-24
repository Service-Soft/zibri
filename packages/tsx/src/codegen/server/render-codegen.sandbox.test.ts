import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { compileServerRender } from './render-codegen';
import { collectTsxFiles } from '../../__testing__/sandbox.helper';
import { Program } from '../../parser/ast';
import { parse } from '../../parser/parser';
import { ComponentInfo, findComponents } from '../../semantics/component';

const templatesDir: string = join(__dirname, '..', '..', '..', '..', 'sandbox', 'src', 'templates');

describe('server codegen against real sandbox templates', () => {
    const files: string[] = collectTsxFiles(templatesDir);

    it.each(files.map(f => [f.split('/templates/')[1], f] as const))(
        'generates syntactically valid JS for %s',
        (_name, file) => {
            const program: Program | undefined = parse(readFileSync(file, 'utf8')).program;
            expect(program).toBeDefined();
            assert(program);
            const components: ComponentInfo[] = findComponents(program);
            expect(components.length).toBeGreaterThan(0);
            for (const component of components) {
                const code: string = compileServerRender(component).code;
                // Constructing a Function validates syntax without executing the body.
                // eslint-disable-next-line typescript/no-implied-eval
                expect(() => new Function('$ssr', code)).not.toThrow();
            }
        }
    );
});
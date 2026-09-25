import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { compileServerRender } from './render-codegen';
import { parseTemplateOk } from '../../__testing__/parse.helper';
import { collectTsxFiles } from '../../__testing__/sandbox.helper';
import { ComponentInfo, findComponents } from '../../semantics/component';
import { eraseTypes } from '../erase-types';

const templatesDir: string = join(__dirname, '..', '..', '..', '..', 'sandbox', 'src', 'templates');

describe('server codegen against real sandbox templates', () => {
    const files: string[] = collectTsxFiles(templatesDir);

    it.each(files.map(f => [f.split('/templates/')[1], f] as const))(
        'generates syntactically valid JS for %s',
        (_name, file) => {
            const components: ComponentInfo[] = findComponents(parseTemplateOk(readFileSync(file, 'utf8')));
            expect(components.length).toBeGreaterThan(0);
            for (const component of components) {
                const code: string = eraseTypes(compileServerRender(component).code);
                // Constructing a Function validates syntax without executing the body.
                // eslint-disable-next-line typescript/no-implied-eval
                expect(() => new Function('$ssr', code)).not.toThrow();
            }
        }
    );
});
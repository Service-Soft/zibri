import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from '@jest/globals';
import { parse } from 'handlebars';

import { AstProgram } from '../ast.model';
import { generateHandlebarType } from '../generate-handlebar-types.function';

describe('generateHandlebarType', () => {
    it('example.hbs', async () => {
        const src: string = await readFile(path.join(__dirname, 'example.hbs'), 'utf8');
        const ast: AstProgram = parse(src, { srcName: './example.hbs' }) as AstProgram;
        const lines: string[] = await generateHandlebarType(ast, 'example.hbs');

        expect(lines).toEqual([
            '// auto-generated — do not edit',
            'import raw from \'./example.hbs\';',
            '',
            'interface Context {',
            '    user: {',
            '        name: string,',
            '    },',
            '    tasks: {',
            '        completed: string,',
            '        title: string,',
            '        subTasks: {',
            '            completed: string,',
            '            title: string,',
            '            length: string,',
            '            data: {',
            '                categories: string[],',
            '            },',
            '        }[],',
            '    }[],',
            '    categories: string[],',
            '}',
            '',
            'const renderTemplate: (ctx: Context) => string = raw;',
            'export default renderTemplate;'
        ]);
    });

    it('example-2.hbs', async () => {
        const src: string = await readFile(path.join(__dirname, 'example-2.hbs'), 'utf8');
        const ast: AstProgram = parse(src, { srcName: './example-2.hbs' }) as AstProgram;
        const lines: string[] = await generateHandlebarType(ast, 'example-2.hbs');

        expect(lines).toEqual([
            '// auto-generated — do not edit',
            'import raw from \'./example-2.hbs\';',
            '',
            'interface Context {',
            '    user: {',
            '        name: string,',
            '    },',
            '    tasks: {',
            '        completed: string,',
            '        title: string,',
            '        subTasks: {',
            '            completed: string,',
            '            title: string,',
            '            length: string,',
            '            data: {',
            '                categories: string[],',
            '            },',
            '        }[],',
            '    }[],',
            '    categories: string[],',
            '}',
            '',
            'const renderTemplate: (ctx: Context) => string = raw;',
            'export default renderTemplate;'
        ]);
    });
});
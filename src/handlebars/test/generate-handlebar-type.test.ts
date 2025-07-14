import { readFile } from 'fs/promises';
import * as fsPromises from 'fs/promises';
import path from 'path';

import { describe, expect, it, jest } from '@jest/globals';
import { parse } from 'handlebars';

import { AstProgram } from '../ast.model';
import { generateHandlebarType } from '../generate-handlebar-type-files.function';

jest.mock('fs/promises', () => {
    // Pull in the real implementations…
    const actual: typeof fsPromises = jest.requireActual<typeof fsPromises>('fs/promises');
    return {
        ...actual,
        // replace only writeFile with a jest.fn()
        writeFile: jest.fn()
    };
});

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
            '        name: string',
            '    },',
            '    tasks: {',
            '        completed: string,',
            '        title: string,',
            '        subTasks: {',
            '            completed: string,',
            '            title: string,',
            '            length: string,',
            '            data: {',
            '                categories: string[]',
            '            }',
            '        }[]',
            '    }[],',
            '    categories: string[]',
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
            '    currentUser: {',
            '        name: string,',
            '        role: string,',
            '        isGuest: string,',
            '        email: string,',
            '        displayName: string,',
            '        permissions: string',
            '    },',
            '    featuredPosts: {',
            '        id: string,',
            '        title: string,',
            '        summary: string',
            '    }[],',
            '    comments: {',
            '        author: string,',
            '        date: string,',
            '        body: string,',
            '        replies: string[]',
            '    }[],',
            '    site: {',
            '        mode: string',
            '    },',
            '    year: string',
            '}',
            '',
            'const renderTemplate: (ctx: Context) => string = raw;',
            'export default renderTemplate;'
        ]);
    });
});
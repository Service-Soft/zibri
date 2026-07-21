import * as fsPromises from 'node:fs/promises';

import { describe, expect, it, jest } from '@jest/globals';

import { FsUtilities } from '../../utilities/fs.utilities';
import { AstProgram } from '../ast.model';
import { generateHandlebarType } from '../generate-handlebar-type-files.function';
import { HandlebarUtilities } from '../handlebar.utilities';

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
        const src: string = await FsUtilities.readFile(FsUtilities.getPath(__dirname, 'example.hbs'));
        const ast: AstProgram = HandlebarUtilities.parse(src, { srcName: './example.hbs' });
        const lines: string[] = await generateHandlebarType(ast, FsUtilities.getPath('example.hbs'));

        expect(lines).toEqual([
            '// auto-generated — do not edit',
            'import raw from \'./example.hbs\';',
            '',
            'type Context = {',
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
            '};',
            '',
            'const renderTemplate: (ctx: Context) => string = raw;',
            'export default renderTemplate;'
        ]);
    });

    it('example-2.hbs', async () => {
        const src: string = await FsUtilities.readFile(FsUtilities.getPath(__dirname, 'example-2.hbs'));
        const ast: AstProgram = HandlebarUtilities.parse(src, { srcName: './example-2.hbs' });
        const lines: string[] = await generateHandlebarType(ast, FsUtilities.getPath('example-2.hbs'));

        expect(lines).toEqual([
            '// auto-generated — do not edit',
            'import raw from \'./example-2.hbs\';',
            '',
            'type Context = {',
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
            '};',
            '',
            'const renderTemplate: (ctx: Context) => string = raw;',
            'export default renderTemplate;'
        ]);
    });
});
import { afterEach, describe, expect, it } from '@jest/globals';

import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { AstProgram } from '../ast.model';
import { generateHandlebarType } from '../generate-handlebar-type-files.function';
import { HandlebarUtilities } from '../handlebar.utilities';

// the type file is written next to the template path it is given, so that path points into the test
// output folder - a cwd-relative one put the generated files into the package root
const outputFolder: FsPath = FsUtilities.getPath(testFileFolder, 'handlebars-type');

describe('generateHandlebarType', () => {
    afterEach(async () => {
        await FsUtilities.rm(outputFolder);
    });

    it('example.hbs', async () => {
        const src: string = await FsUtilities.readFile(FsUtilities.getPath(__dirname, 'example.hbs'));
        const ast: AstProgram = HandlebarUtilities.parse(src, { srcName: './example.hbs' });
        const lines: string[] = await generateHandlebarType(ast, FsUtilities.getPath(outputFolder, 'example.hbs'));

        expect(await FsUtilities.readFile(FsUtilities.getPath(outputFolder, 'example.hbs.ts'))).toBe(lines.join('\n'));
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
        const lines: string[] = await generateHandlebarType(ast, FsUtilities.getPath(outputFolder, 'example-2.hbs'));

        expect(await FsUtilities.readFile(FsUtilities.getPath(outputFolder, 'example-2.hbs.ts'))).toBe(lines.join('\n'));
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
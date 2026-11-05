import { describe, expect, it } from '@jest/globals';

import { ProjectTemplateUtilities } from './project-template.utilities';

describe('ProjectTemplateUtilities', () => {
    it('finds every file of a project once, without the suffix of its template', async () => {
        const filePaths: string[] = await ProjectTemplateUtilities.findFilePaths();

        expect(filePaths).toEqual(expect.arrayContaining(['package.json', '.env.example', 'versions/.gitkeep', 'src/index.ts']));
        expect(filePaths.filter(filePath => filePath.endsWith('.tpl'))).toEqual([]);
    });

    it('keeps a section alone on its lines with them when its flag is set, and leaves out the lines when it is not', async () => {
        await expect(ProjectTemplateUtilities.resolveFile('src/controllers/index.ts', { pages: true, mailingList: true })).resolves.toBe([
            'export * from \'./auth.controller\';',
            'export * from \'./health.controller\';',
            'export * from \'./page.controller\';',
            'export * from \'./mailing-list.controller\';',
            ''
        ].join('\n'));
        await expect(ProjectTemplateUtilities.resolveFile('src/controllers/index.ts', { pages: false, mailingList: false })).resolves.toBe([
            'export * from \'./auth.controller\';',
            'export * from \'./health.controller\';',
            ''
        ].join('\n'));
    });

    it('leaves out a comment, with the lines it stands on', async () => {
        await expect(ProjectTemplateUtilities.resolveFile('versions/.gitkeep', {})).resolves.toBe('');
    });

    // a marker written into a generated file is a file that does not build, found by whoever runs it
    it('refuses a template naming a flag it is not rendered with', async () => {
        await expect(ProjectTemplateUtilities.resolveFile('src/controllers/index.ts', {}))
            .rejects.toThrow('The template of "src/controllers/index.ts" has a section "pages", which is no flag it is rendered with.');
    });

    it('refuses a template naming a value it is not rendered with', async () => {
        await expect(ProjectTemplateUtilities.resolveFile('package.json', { name: 'api' }))
            .rejects.toThrow('The template of "package.json" names "author", which is no value it is rendered with.');
    });
});
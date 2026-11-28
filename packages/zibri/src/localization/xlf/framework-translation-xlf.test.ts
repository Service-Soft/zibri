import { beforeAll, describe, expect, it } from '@jest/globals';

import { initDiContainer } from '../../di/init-di-container.function';
import { XmlUtilities } from '../../document/xml.utilities';
import { GlobalRegistry } from '../../global/global-registry';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { resolveZibriRoot } from '../../utilities/resolve-zibri-root.function';
import { XliffDocument } from './models/xliff-document.model';
import { parseSourceXlf } from './parse-source-xlf.function';
import { parseTranslationXlf } from './parse-translation-xlf.function';

type ZibriPackageJson = {
    translations: Record<string, string>
};

// the translations zibri ships of its own strings, which "npm run build" keeps in step with
// source.xlf. A string added since is what this finds, until somebody translates it
const root: FsPath = resolveZibriRoot();
const { translations } = JsonUtilities.parse<ZibriPackageJson>(FsUtilities.readFileSync(FsUtilities.getPath(root, 'package.json')));

// the names `$t` substitutes, read the way it reads them: `{{` and `}}` are a brace of the text
function resolvePlaceholderNames(text: string): string[] {
    return [...new Set([...text.matchAll(/{{|}}|{([^}]+)}/g)].flatMap(match => match[1] == undefined ? [] : [match[1]]))].sort();
}

let sources: string[];

beforeAll(async () => {
    initDiContainer();
    // validation problems are translated, which needs an application that exists
    GlobalRegistry.markAppAsCreated();
    const sourceXlf: string = await FsUtilities.readFile(FsUtilities.getPath(root, 'translations', 'source.xlf'));
    sources = [...new Set((await parseSourceXlf(sourceXlf)).map(string => string.source))];
});

describe.each(ObjectUtilities.entries(translations))('the "%s" translation zibri ships, %s', (_locale, file) => {
    let content: string;
    let translated: Record<string, string>;

    beforeAll(async () => {
        content = await FsUtilities.readFile(FsUtilities.getPath(root, file));
        translated = await parseTranslationXlf(content);
    });

    it('translates every string of source.xlf', () => {
        expect(sources.filter(source => translated[source] == undefined)).toEqual([]);
    });

    it('holds no string source.xlf does not', async () => {
        const document: XliffDocument = await XmlUtilities.parseFrom(XliffDocument, content, { allowAdditionalProperties: true });
        const ids: string[] = (document.files ?? []).flatMap(xliffFile => (xliffFile.body.units ?? []).map(unit => unit.id));

        expect(ids.filter(id => !sources.includes(id))).toEqual([]);
    });

    it('keeps the placeholders of each source, and adds none', () => {
        const differing: string[] = ObjectUtilities.entries(translated)
            .filter(([source, translation]) => resolvePlaceholderNames(source).join() !== resolvePlaceholderNames(translation).join())
            .map(([source, translation]) => `${source} => ${translation}`);

        expect(differing).toEqual([]);
    });
});
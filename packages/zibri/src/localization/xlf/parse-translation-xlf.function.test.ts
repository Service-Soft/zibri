import { beforeAll, describe, expect, it } from 'vitest';

import { parseTranslationXlf } from './parse-translation-xlf.function.ts';
import { initDiContainer } from '../../di/init-di-container.function.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';

function xliffWithUnits(units: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
    <file source-language="en" target-language="de" datatype="plaintext" original="zibri">
        <body>
            ${units}
        </body>
    </file>
</xliff>`;
}

beforeAll(() => {
    initDiContainer();
    // validation problems are translated, which needs an application that exists
    GlobalRegistry.markAppAsCreated();
});

describe('parseTranslationXlf', () => {
    it('maps source id to its translated target', async () => {
        const xlf: string = xliffWithUnits(
            '<trans-unit id="Hello" xml:space="preserve"><source>Hello</source><target>Hallo</target></trans-unit>'
        );

        expect(await parseTranslationXlf(xlf)).toEqual({ Hello: 'Hallo' });
    });

    it('parses multiple trans-units', async () => {
        const xlf: string = xliffWithUnits([
            '<trans-unit id="Hello" xml:space="preserve"><source>Hello</source><target>Hallo</target></trans-unit>',
            '<trans-unit id="Goodbye" xml:space="preserve"><source>Goodbye</source><target>Auf Wiedersehen</target></trans-unit>'
        ].join(''));

        expect(await parseTranslationXlf(xlf)).toEqual({ Hello: 'Hallo', Goodbye: 'Auf Wiedersehen' });
    });

    it('reads a placeholder the translator kept as the <x/> of the source', async () => {
        const xlf: string = xliffWithUnits([
            '<trans-unit id="Hello {name}!" xml:space="preserve">',
            '<source>Hello <x id="name" equiv-text="{name}"/>!</source>',
            '<target>Hallo <x id="name" equiv-text="{name}"/>!</target>',
            '</trans-unit>'
        ].join(''));

        expect(await parseTranslationXlf(xlf)).toEqual({ 'Hello {name}!': 'Hallo {name}!' });
    });

    it('decodes what xml reserves, in the id and in the translation', async () => {
        const xlf: string = xliffWithUnits(
            '<trans-unit id="Tom &amp; Jerry"><source>Tom &amp; Jerry</source><target>Tom &#x26; &lt;Jerry&gt;</target></trans-unit>'
        );

        expect(await parseTranslationXlf(xlf)).toEqual({ 'Tom & Jerry': 'Tom & <Jerry>' });
    });

    it('reads what a translation tool adds around a translation, and ignores it', async () => {
        const xlf: string = xliffWithUnits([
            '<trans-unit id="Hello" approved="yes">',
            '<source>Hello</source><target state="translated">Hallo</target>',
            '<context-group purpose="location"><context context-type="sourcefile">a.ts</context></context-group>',
            '</trans-unit>'
        ].join(''));

        expect(await parseTranslationXlf(xlf)).toEqual({ Hello: 'Hallo' });
    });

    it('skips trans-units without a target (not yet translated)', async () => {
        const xlf: string = xliffWithUnits(
            '<trans-unit id="Hello" xml:space="preserve"><source>Hello</source></trans-unit>'
        );

        expect(await parseTranslationXlf(xlf)).toEqual({});
    });

    it('returns an empty object for a document with no files', async () => {
        const xlf: string = '<?xml version="1.0" encoding="utf-8"?><xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"></xliff>';
        expect(await parseTranslationXlf(xlf)).toEqual({});
    });
});
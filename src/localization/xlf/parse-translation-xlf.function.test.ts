import { describe, expect, it } from '@jest/globals';

import { parseTranslationXlf } from './parse-translation-xlf.function';

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

describe('parseTranslationXlf', () => {
    it('maps source id to its translated target', () => {
        const xlf: string = xliffWithUnits(
            '<trans-unit id="Hello" xml:space="preserve"><source>Hello</source><target>Hallo</target></trans-unit>'
        );

        expect(parseTranslationXlf(xlf)).toEqual({ Hello: 'Hallo' });
    });

    it('parses multiple trans-units', () => {
        const xlf: string = xliffWithUnits([
            '<trans-unit id="Hello" xml:space="preserve"><source>Hello</source><target>Hallo</target></trans-unit>',
            '<trans-unit id="Goodbye" xml:space="preserve"><source>Goodbye</source><target>Auf Wiedersehen</target></trans-unit>'
        ].join(''));

        expect(parseTranslationXlf(xlf)).toEqual({ Hello: 'Hallo', Goodbye: 'Auf Wiedersehen' });
    });

    it('skips trans-units without a target (not yet translated)', () => {
        const xlf: string = xliffWithUnits(
            '<trans-unit id="Hello" xml:space="preserve"><source>Hello</source></trans-unit>'
        );

        expect(parseTranslationXlf(xlf)).toEqual({});
    });

    it('returns an empty object for a document with no files', () => {
        const xlf: string = '<?xml version="1.0" encoding="utf-8"?><xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"></xliff>';
        expect(parseTranslationXlf(xlf)).toEqual({});
    });
});
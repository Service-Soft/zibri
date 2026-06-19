import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { defineDateFormat } from './define-date-format.function';
import { LocalizeService } from './localize.service';
import { LocaleCode } from './models/locale-code.model';
import { LocaleConfiguration, LocalizeOptions } from './models/localize-options.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { ObjectUtilities } from '../utilities/object.utilities';

type ResolutionCase = {
    readonly header: string,
    readonly supportedLocales: readonly LocaleCode[],
    readonly expected: LocaleCode | undefined
};

const localeConfiguration: LocaleConfiguration = {
    currencyCode: 'EUR',
    defaultDateFormat: defineDateFormat('YYYY-MM-DD'),
    defaultDateTimeFormat: defineDateFormat('YYYY-MM-DD HH:mm:ss'),
    defaultTimeFormat: defineDateFormat('HH:mm:ss')
};

let localizeService: LocalizeService;

function clearSupportedLocales(): void {
    const supportedLocales: LocalizeOptions['supportedLocales'] = localizeService['options'].supportedLocales;
    for (const locale of ObjectUtilities.keys(supportedLocales)) {
        // eslint-disable-next-line typescript/no-dynamic-delete
        delete supportedLocales[locale];
    }
}

function setSupportedLocales(...locales: readonly LocaleCode[]): void {
    clearSupportedLocales();

    const supportedLocales: LocalizeOptions['supportedLocales'] = localizeService['options'].supportedLocales;
    for (const locale of locales) {
        supportedLocales[locale] = localeConfiguration;
    }
}

describe('LocalizeService', () => {
    beforeAll(() => {
        initDiContainer();
        localizeService = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE) as LocalizeService;
    });

    beforeEach(() => {
        clearSupportedLocales();
    });

    it.each<ResolutionCase>([
        {
            header: 'en',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'en',
            supportedLocales: ['en-GB'],
            expected: 'en-GB'
        },
        {
            header: 'en-US',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        },
        {
            header: 'en-US',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'en-US,en;q=0.9',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        },
        {
            header: 'en-US,en;q=0.9',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
            supportedLocales: ['de-DE'],
            expected: 'de-DE'
        },
        {
            header: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        },
        {
            header: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'fr-CH, fr;q=0.9, en;q=0.8',
            supportedLocales: ['fr-CH'],
            expected: 'fr-CH'
        },
        {
            header: 'fr-CH, fr;q=0.9, en;q=0.8',
            supportedLocales: ['fr'],
            expected: 'fr'
        },
        {
            header: 'fr-CH, fr;q=0.9, en;q=0.8',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'fr-CH, fr;q=0.9, en;q=0.8',
            supportedLocales: ['fr-FR', 'en'],
            expected: 'fr-FR'
        },
        {
            header: 'zh-Hans-CN,zh;q=0.9,en;q=0.8',
            supportedLocales: ['zh-Hans-CN'],
            expected: 'zh-Hans-CN'
        },
        {
            header: 'zh-Hans-CN,zh;q=0.9,en;q=0.8',
            supportedLocales: ['zh-Hans'],
            expected: 'zh-Hans'
        },
        {
            header: 'zh-Hans-CN,zh;q=0.9,en;q=0.8',
            supportedLocales: ['zh'],
            expected: 'zh'
        },
        {
            header: 'zh-Hans-CN,zh;q=0.9,en;q=0.8',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'zh-Hant-TW,zh-Hant;q=0.9,zh;q=0.8',
            supportedLocales: ['zh-Hant-TW'],
            expected: 'zh-Hant-TW'
        },
        {
            header: 'zh-Hant-TW,zh-Hant;q=0.9,zh;q=0.8',
            supportedLocales: ['zh-Hant'],
            expected: 'zh-Hant'
        },
        {
            header: 'zh-Hant-TW,zh-Hant;q=0.9,zh;q=0.8',
            supportedLocales: ['zh'],
            expected: 'zh'
        },
        {
            header: 'en-GB,en;q=0.9',
            supportedLocales: ['en-GB'],
            expected: 'en-GB'
        },
        {
            header: 'en-GB,en;q=0.9',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'en-GB,en;q=0.9',
            supportedLocales: ['de-DE'],
            expected: undefined
        },
        {
            header: 'de-DE,de;q=0.9,de-AT;q=0.8,de-CH;q=0.7',
            supportedLocales: ['de-DE'],
            expected: 'de-DE'
        },
        {
            header: 'de-DE,de;q=0.9,de-AT;q=0.8,de-CH;q=0.7',
            supportedLocales: ['de'],
            expected: 'de'
        },
        {
            header: 'en-US;q=0.95,en;q=0.9,*;q=0.1',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        },
        {
            header: 'en-US;q=0.95,en;q=0.9,*;q=0.1',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'en-US;q=0.95,en;q=0.9,*;q=0.1',
            supportedLocales: ['de-DE'],
            expected: undefined
        },
        {
            header: 'en;q=0.9,de;q=0.9',
            supportedLocales: ['en', 'de'],
            expected: 'en'
        },
        {
            header: 'de;q=0.9,en;q=0.9',
            supportedLocales: ['en', 'de'],
            expected: 'de'
        },
        {
            header: 'en;q=0.7,de;q=0.3',
            supportedLocales: ['de', 'en'],
            expected: 'en'
        },
        {
            header: 'de;q=1.0,en;q=0.5',
            supportedLocales: ['de', 'en'],
            expected: 'de'
        }
    ])('resolves "$header" with supportedLocales=$supportedLocales', ({ header, supportedLocales, expected }) => {
        setSupportedLocales(...supportedLocales);
        expect(localizeService.resolveSupportedLocaleFromAcceptLanguageString(header)).toBe(expected);
    });

    it.each<ResolutionCase>([
        {
            header: '',
            supportedLocales: ['en', 'de-DE'],
            expected: undefined
        },
        {
            header: ' ',
            supportedLocales: ['en', 'de-DE'],
            expected: undefined
        },
        {
            header: ',',
            supportedLocales: ['en', 'de-DE'],
            expected: undefined
        },
        {
            header: ',,',
            supportedLocales: ['en', 'de-DE'],
            expected: undefined
        },
        {
            header: 'english',
            supportedLocales: ['en', 'de-DE'],
            expected: undefined
        },
        {
            header: 'en_US',
            supportedLocales: ['en', 'de-DE'],
            expected: 'en'
        },
        {
            header: '*',
            supportedLocales: ['en', 'de-DE'],
            expected: undefined
        },
        {
            header: '*;q=1.0',
            supportedLocales: ['en', 'de-DE'],
            expected: undefined
        },
        {
            header: 'en-US;q=',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        },
        {
            header: 'en-US;q=abc',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        },
        {
            header: 'en;q=',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'en;q=1.1',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'en;q=-1',
            supportedLocales: ['en'],
            expected: 'en'
        },
        {
            header: 'de-DE;q=abc',
            supportedLocales: ['de-DE'],
            expected: 'de-DE'
        },
        {
            header: 'en-US;q=0',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        },
        {
            header: 'en-US;q=.8',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        },
        {
            header: 'en-US;q=0.123',
            supportedLocales: ['en-US'],
            expected: 'en-US'
        }
    ])('handles malformed "$header" with supportedLocales=$supportedLocales', ({ header, supportedLocales, expected }) => {
        setSupportedLocales(...supportedLocales);
        expect(localizeService.resolveSupportedLocaleFromAcceptLanguageString(header)).toBe(expected);
    });
});
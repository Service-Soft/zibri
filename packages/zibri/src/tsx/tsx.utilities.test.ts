import { beforeAll, describe, expect, it } from '@jest/globals';
import { CompiledPage } from 'zibri-tsx';

import { TsxComponent } from './tsx-component.model';
import { TsxUtilities } from './tsx.utilities';
import { compileTsxTemplate } from '../__testing__/compile-tsx-template.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { LocaleCode } from '../localization/models/locale-code.model';
import { TranslationRegistry } from '../localization/translation.registry';

/**
 * Compiled templates are objects, while templates declare themselves as functions. Rendering goes
 * through the declared type, so tests hand over the compiled component the same way a controller
 * hands over its imported template.
 * @param source - The template source to compile.
 * @returns The compiled component, typed as the template author sees it.
 */
function templateOf<T>(source: string): TsxComponent<T> {
    const compiled: CompiledPage = compileTsxTemplate(source);
    return compiled as unknown as TsxComponent<T>;
}

describe('TsxUtilities', () => {
    beforeAll(() => {
        initDiContainer();
    });

    describe('renderPage', () => {
        it('renders a static page as a full document without a script', () => {
            const page: TsxComponent = templateOf(
                'export const Home = () => <html><body><h1>Hi</h1></body></html>;'
            );
            expect(TsxUtilities.renderPage(page)).toBe('<!DOCTYPE html>\n<html><body><h1>Hi</h1></body></html>');
        });

        it('escapes interpolated props', () => {
            const page: TsxComponent<{ name: string }> = templateOf(
                'export const Home = ({ name }) => <p>{name}</p>;'
            );
            expect(TsxUtilities.renderPage(page, { name: '<script>x</script>' }))
                .toContain('<p>&lt;script&gt;x&lt;/script&gt;</p>');
        });

        it('attaches the client script and serializes only the props the client uses', () => {
            const page: TsxComponent<{ shown: string, secret: string }> = templateOf(
                'export const Home = ({ shown, secret }) => { onClient(() => { track(shown); }); '
                + 'return <html><body><p>{secret}</p></body></html>; };'
            );

            const html: string = TsxUtilities.renderPage(page, { shown: 'yes', secret: 'do-not-leak' });

            expect(html).toContain('<script>');
            expect(html).toContain('"shown":"yes"');
            // The prop is rendered server side, but must never reach the client script.
            expect(html).toContain('<p>do-not-leak</p>');
            expect(html.split('<script>')[1]).not.toContain('do-not-leak');
        });

        it('wires an event handler into the handler registry', () => {
            const page: TsxComponent = templateOf(
                'export const Home = () => { function pick() { chose(); } '
                + 'return <html><body><button onClick={pick}>Go</button></body></html>; };'
            );

            const html: string = TsxUtilities.renderPage(page);

            expect(html).toContain('data-ssr-handlers="h0_0:click"');
            // The instance is handed its own handler entry, so its setup only wires up its elements.
            expect(html).toContain('"handlers":[{"id":"h0_0","site":"h0","event":"click","captured":[],"owner":0}]');
        });

        it('inlines the active locale and its translations for a client side $ts', () => {
            const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(undefined);
            TranslationRegistry.translations[locale] = { hello: 'translated hello' };

            const page: TsxComponent = templateOf(
                'export const Home = () => { onClient(() => { show($ts`hello`); }); '
                + 'return <html><body></body></html>; };'
            );

            const html: string = TsxUtilities.renderPage(page);

            expect(html).toContain('const $ts =');
            expect(html).toContain('"translated hello"');
            expect(html).toContain(JSON.stringify(locale));
        });

        it('inlines every registered locale, so a client side $t can resolve any of them', () => {
            const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(undefined);
            const otherLocale: LocaleCode = locale === 'de' ? 'en' : 'de';
            TranslationRegistry.translations[locale] = { bye: 'active bye' };
            TranslationRegistry.translations[otherLocale] = { bye: 'other bye' };

            const page: TsxComponent = templateOf(
                'export const Home = () => { onClient(() => { show($t`bye`.getValue(pick())); }); '
                + 'return <html><body></body></html>; };'
            );

            const html: string = TsxUtilities.renderPage(page);

            // Resolving a token for a non active locale is what $t adds over $ts, so both have to ship.
            expect(html).toContain('"active bye"');
            expect(html).toContain('"other bye"');
        });

        it('ships only the translation strings the client looks up', () => {
            const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(undefined);
            TranslationRegistry.translations[locale] = {
                needed: 'needed translation',
                'never asked for': 'unused translation'
            };

            const page: TsxComponent = templateOf(
                'export const Home = () => { onClient(() => { show($ts`needed`); }); '
                + 'return <html><body></body></html>; };'
            );

            const html: string = TsxUtilities.renderPage(page);

            expect(html).toContain('"needed translation"');
            expect(html).not.toContain('unused translation');
        });

        it('inlines the locale format options for a client side $f', () => {
            const page: TsxComponent = templateOf(
                'export const Home = () => { onClient(() => { show($f.date(new Date())); }); '
                + 'return <html><body></body></html>; };'
            );

            const html: string = TsxUtilities.renderPage(page);

            expect(html).toContain('const $f =');
            expect(html).toContain('dateFormat');
            expect(html).toContain('currencyCode');
        });

        it('leaves out hooks the page does not reference', () => {
            const page: TsxComponent = templateOf(
                'export const Home = () => { onClient(() => { track(); }); return <html><body></body></html>; };'
            );

            const html: string = TsxUtilities.renderPage(page);

            expect(html).toContain('<script>');
            expect(html).not.toContain('const $t =');
            expect(html).not.toContain('const $f =');
        });

        it('emits a vendor script tag for a ?client package', () => {
            const page: TsxComponent = templateOf(
                'import { Chart } from \'chart.js?client\';\n'
                + 'export const Home = () => { onClient(() => { new Chart(); }); '
                + 'return <html><head></head><body></body></html>; };'
            );

            expect(TsxUtilities.renderPage(page)).toContain('<script src="/assets/vendor/chart-js.js"></script>');
        });

        it('throws an actionable error for a template that was not compiled', () => {
            const notCompiled: TsxComponent = (() => undefined) as unknown as TsxComponent;
            expect(() => TsxUtilities.renderPage(notCompiled)).toThrow(/was not compiled by zibri-tsx/);
            expect(() => TsxUtilities.renderPage(notCompiled)).toThrow(/zibri-tsx\/webpack/);
        });
    });

    describe('renderEmail', () => {
        it('renders a full document without any script', () => {
            const email: TsxComponent<{ recipient: string }> = templateOf(
                'export const Mail = ({ recipient }) => <html><body><p>Hi {recipient}</p></body></html>;'
            );

            const html: string = TsxUtilities.renderEmail(email, { recipient: 'James Smith' });

            expect(html).toBe('<!DOCTYPE html>\n<html><body><p>Hi James Smith</p></body></html>');
        });

        it('never emits a script, even when the template declares client behavior', () => {
            const email: TsxComponent = templateOf(
                'export const Mail = () => { onClient(() => { track(); }); '
                + 'return <html><body><button onClick={() => track()}>x</button></body></html>; };'
            );

            expect(TsxUtilities.renderEmail(email)).not.toContain('<script');
        });
    });
});
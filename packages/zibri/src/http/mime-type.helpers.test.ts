import { describe, expect, it } from '@jest/globals';

import { MimeType } from './mime-type.enum';
import { isMimeType, resolveFileExtension, resolveMimeType } from './mime-type.helpers';

describe('resolveMimeType', () => {
    it('resolves a known extension to its mime type', () => {
        expect(resolveMimeType('file.json')).toBe(MimeType.JSON);
        expect(resolveMimeType('archive.tar')).toBe(MimeType.TAR);
        expect(resolveMimeType('image.jpeg')).toBe(MimeType.JPEG);
    });

    it('is case insensitive', () => {
        expect(resolveMimeType('IMAGE.PNG')).toBe(MimeType.PNG);
    });

    it('resolves multiple known aliases of the same mime type', () => {
        expect(resolveMimeType('a.jpg')).toBe(MimeType.JPEG);
        expect(resolveMimeType('a.jpe')).toBe(MimeType.JPEG);
        expect(resolveMimeType('a.yml')).toBe(MimeType.YAML);
        expect(resolveMimeType('a.yaml')).toBe(MimeType.YAML);
    });

    it('falls back to octet-stream for an unknown extension', () => {
        // eslint-disable-next-line cspell/spellchecker
        expect(resolveMimeType('file.unknownext')).toBe(MimeType.OCTET_STREAM);
    });

    it('falls back to octet-stream for a path without an extension', () => {
        expect(resolveMimeType('file-without-extension')).toBe(MimeType.OCTET_STREAM);
    });

    it('resolves a path with a directory component correctly', () => {
        expect(resolveMimeType('/some/dir/file.pdf')).toBe(MimeType.PDF);
    });
});

describe('resolveFileExtension', () => {
    it('resolves the first known extension for a mime type', () => {
        expect(resolveFileExtension(MimeType.JPEG)).toBe('.jpeg');
        expect(resolveFileExtension(MimeType.YAML)).toBe('.yaml');
    });

    it('returns undefined for a mime type with no known extension', () => {
        // eslint-disable-next-line cspell/spellchecker
        expect(resolveFileExtension(MimeType.JSON_LD)).toBe('.jsonld');
        expect(resolveFileExtension('unknown/mime-type')).toBeUndefined();
    });
});

describe('isMimeType', () => {
    it('returns true for a known mime type', () => {
        expect(isMimeType(MimeType.JSON)).toBe(true);
        expect(isMimeType('application/json')).toBe(true);
    });

    it('returns false for an unknown mime type', () => {
        expect(isMimeType('not/a-mime-type')).toBe(false);
        expect(isMimeType('')).toBe(false);
    });
});
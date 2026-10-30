import { describe, expect, it } from '@jest/globals';

import { MimeType } from './mime-type.enum';
import { MimeTypeUtilities } from './mime-type.utilities';

describe('MimeTypeUtilities.resolveFromPath', () => {
    it('resolves a known extension to its mime type', () => {
        expect(MimeTypeUtilities.resolveFromPath('file.json')).toBe(MimeType.JSON);
        expect(MimeTypeUtilities.resolveFromPath('archive.tar')).toBe(MimeType.TAR);
        expect(MimeTypeUtilities.resolveFromPath('image.jpeg')).toBe(MimeType.JPEG);
    });

    it('is case insensitive', () => {
        expect(MimeTypeUtilities.resolveFromPath('IMAGE.PNG')).toBe(MimeType.PNG);
    });

    it('resolves multiple known aliases of the same mime type', () => {
        expect(MimeTypeUtilities.resolveFromPath('a.jpg')).toBe(MimeType.JPEG);
        expect(MimeTypeUtilities.resolveFromPath('a.jpe')).toBe(MimeType.JPEG);
        expect(MimeTypeUtilities.resolveFromPath('a.yml')).toBe(MimeType.YAML);
        expect(MimeTypeUtilities.resolveFromPath('a.yaml')).toBe(MimeType.YAML);
    });

    it('falls back to octet-stream for an unknown extension', () => {
        // eslint-disable-next-line cspell/spellchecker
        expect(MimeTypeUtilities.resolveFromPath('file.unknownext')).toBe(MimeType.OCTET_STREAM);
    });

    it('falls back to octet-stream for a path without an extension', () => {
        expect(MimeTypeUtilities.resolveFromPath('file-without-extension')).toBe(MimeType.OCTET_STREAM);
    });

    it('resolves a path with a directory component correctly', () => {
        expect(MimeTypeUtilities.resolveFromPath('/some/dir/file.pdf')).toBe(MimeType.PDF);
    });
});

describe('MimeTypeUtilities.resolveFileExtension', () => {
    it('resolves the first known extension for a mime type', () => {
        expect(MimeTypeUtilities.resolveFileExtension(MimeType.JPEG)).toBe('.jpeg');
        expect(MimeTypeUtilities.resolveFileExtension(MimeType.YAML)).toBe('.yaml');
    });

    it('returns undefined for a mime type with no known extension', () => {
        // eslint-disable-next-line cspell/spellchecker
        expect(MimeTypeUtilities.resolveFileExtension(MimeType.JSON_LD)).toBe('.jsonld');
        expect(MimeTypeUtilities.resolveFileExtension('unknown/mime-type')).toBeUndefined();
    });
});

describe('MimeTypeUtilities.isKnown', () => {
    it('returns true for a known mime type', () => {
        expect(MimeTypeUtilities.isKnown(MimeType.JSON)).toBe(true);
        expect(MimeTypeUtilities.isKnown('application/json')).toBe(true);
    });

    it('returns false for an unknown mime type', () => {
        expect(MimeTypeUtilities.isKnown('not/a-mime-type')).toBe(false);
        expect(MimeTypeUtilities.isKnown('')).toBe(false);
    });
});

describe('MimeTypeUtilities.isJson', () => {
    it('answers yes for json and a +json format', () => {
        expect(MimeTypeUtilities.isJson(MimeType.JSON)).toBe(true);
        expect(MimeTypeUtilities.isJson('application/scim+json')).toBe(true);
    });

    it('answers no for a type that is not json', () => {
        expect(MimeTypeUtilities.isJson(MimeType.XML)).toBe(false);
    });
});

describe('MimeTypeUtilities.isXml', () => {
    it('answers yes for the two generic xml types only', () => {
        expect(MimeTypeUtilities.isXml(MimeType.XML)).toBe(true);
        expect(MimeTypeUtilities.isXml(MimeType.TEXT_XML)).toBe(true);
        expect(MimeTypeUtilities.isXml(MimeType.SVG)).toBe(false);
    });
});

describe('MimeTypeUtilities.isCompressible', () => {
    it('reads the type of a content type header with parameters', () => {
        expect(MimeTypeUtilities.isCompressible('Application/JSON; charset=utf-8')).toBe(true);
    });

    it('answers no for an already compressed or unknown type', () => {
        expect(MimeTypeUtilities.isCompressible(MimeType.PNG)).toBe(false);
        expect(MimeTypeUtilities.isCompressible('application/x-unknown')).toBe(false);
    });
});
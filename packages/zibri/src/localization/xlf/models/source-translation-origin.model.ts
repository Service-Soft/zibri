import { FsPath, GlobPattern } from '../../../utilities/fs.utilities';
import { LocaleCode } from '../../models/locale-code.model';

/**
 * Files scanned for the strings they mark for translation, such as the sources of the project.
 */
export type ScannedTranslationOrigin = {
    /**
     * The name of the origin, such as 'project'.
     */
    origin: string,
    /**
     * The locale the strings of the origin are written in.
     */
    originLocale: LocaleCode,
    /**
     * The files scanned for strings marked for translation.
     */
    patterns: GlobPattern
};

/**
 * An origin whose strings were extracted by its own build, such as a library that ships its
 * `source.xlf`.
 */
export type ShippedTranslationOrigin = {
    /**
     * The `source.xlf` the origin ships, whose strings are taken as they are.
     */
    sourceXlf: FsPath
};

/**
 * Where the strings marked for translation come from: files to scan, or a `source.xlf` another
 * build wrote.
 */
export type SourceTranslationOrigin = ScannedTranslationOrigin | ShippedTranslationOrigin;
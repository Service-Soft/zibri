import { generateXlf } from './generate-xlf.function.ts';
import { ExtractedTranslationString, SourceTranslationOrigin, TransformResult, transformSourceTranslationOriginTokens } from './transform-source-translation-tokens.function.ts';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities.ts';
import { optionalPeer } from '../../utilities/optional-peer.function.ts';

/**
 * Generates the source xlf, consisting of all the translation tokens of the codebase.
 * @param origins - Definition of places to search for translation tokens.
 */
export async function generateSourceXlf(
    origins: SourceTranslationOrigin[]
): Promise<void> {
    // before the sources are read rather than once they have been: that part is the slow one. The
    // document written from them is checked with saxes, like every document generateFrom writes
    optionalPeer('saxes', 'Extracting source translations');
    const res: Record<string, TransformResult> = await transformSourceTranslationOriginTokens(origins);

    const allStrings: ExtractedTranslationString[] = Object.values(res).map(v => v.extracted).flat();
    const outputPath: FsPath = FsUtilities.getPath(process.cwd(), 'translations/source.xlf');

    const newXlf: string = generateXlf(allStrings);
    let existing: string = '';
    try {
        existing = await FsUtilities.readFile(outputPath);
    }
    catch {}

    if (existing !== newXlf) {
        await FsUtilities.upsertFile(outputPath, newXlf);
    }
}
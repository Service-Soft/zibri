import { extractTranslationStrings } from './extract-translation-strings.function';
import { generateXlf } from './generate-xlf.function';
import { ExtractedTranslationString } from './models/extracted-translation-string.model';
import { ScannedTranslationOrigin, ShippedTranslationOrigin, SourceTranslationOrigin } from './models/source-translation-origin.model';
import { parseSourceXlf } from './parse-source-xlf.function';
import { initDiContainer } from '../../di/init-di-container.function';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { optionalPeer } from '../../utilities/optional-peer.function';

/**
 * Writes `translations/source.xlf` of the given root, holding every string the origins mark for
 * translation.
 *
 * An origin is either scanned for its strings, or a `source.xlf` another build wrote, which is
 * taken as it is.
 * @param root - The root of the project the file is written for.
 * @param origins - Where the strings come from.
 */
export async function generateSourceXlf(root: FsPath, origins: SourceTranslationOrigin[]): Promise<void> {
    // before the sources are read rather than once they have been: that part is the slow one. The
    // document written from them is checked with saxes, like every document generateFrom writes
    optionalPeer('saxes', 'Extracting source translations');
    const scanned: ScannedTranslationOrigin[] = origins.filter(origin => 'patterns' in origin);
    const shipped: ShippedTranslationOrigin[] = origins.filter(origin => 'sourceXlf' in origin);
    if (shipped.length) {
        // a shipped source.xlf is read as the model it was written as, which validates it, and
        // validating needs the container - a build has none until something fills it
        initDiContainer();
    }

    const [extracted, ...parsed] = await Promise.all([
        extractTranslationStrings(root, scanned),
        ...shipped.map(async origin => await parseSourceXlf(await FsUtilities.readFile(origin.sourceXlf)))
    ]);
    const allStrings: ExtractedTranslationString[] = [...extracted, ...parsed.flat()];
    const outputPath: FsPath = FsUtilities.getPath(root, 'translations', 'source.xlf');

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
import { ScannedTranslationOrigin } from './models/source-translation-origin.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';

/**
 * The framework's own sources, as its build scans them for the strings it marks for translation.
 *
 * What ships is scanned: the tests, the cases they share and the test fixtures are left out, as
 * they are left out of the package.
 * @param root - The root of the framework package.
 * @returns The origin, named 'zibri'.
 */
export function getFrameworkTranslationOrigin(root: FsPath): ScannedTranslationOrigin {
    return {
        origin: 'zibri',
        originLocale: 'en-US',
        patterns: {
            include: `${FsUtilities.getPath(root, 'src')}/**/*.{ts,tsx}`,
            exclude: ['**/*.test.{ts,tsx}', '**/*.cases.ts', '**/__testing__/**', '**/test/**']
        }
    };
}
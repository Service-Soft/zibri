/* eslint-disable cspell/spellchecker */
/**
 * Measures how similar two texts are by the runs of three characters they share.
 *
 * The measure a fuzzy search matches by and a similarity order sorts by, so that every store that
 * answers either of them in process gives the same answer.
 */
export abstract class TrigramUtilities {

    /**
     * Calculates the trigram similarity of two strings the same way that the postgres pg_trgm extension does.
     * @param a - The first string.
     * @param b - The second string.
     * @returns The similarity as a value between 0 and 1.
     */
    static resolveSimilarity(a: string, b: string): number {
        const aTrigrams: Set<string> = this.trigramsOf(a);
        const bTrigrams: Set<string> = this.trigramsOf(b);
        if (!aTrigrams.size && !bTrigrams.size) {
            return 0;
        }
        let shared: number = 0;
        for (const trigram of aTrigrams) {
            if (bTrigrams.has(trigram)) {
                shared++;
            }
        }
        return shared / (aTrigrams.size + bTrigrams.size - shared);
    }

    private static trigramsOf(value: string): Set<string> {
        const res: Set<string> = new Set();
        // a word is a run of letters and digits of any script, the way pg_trgm reads one on a database
        // of a unicode locale - ascii alone split "müller" into "m" and "ller", which made it the
        // same text as "möller"
        const words: string[] = value.toLowerCase().split(/[^\p{L}\p{N}]+/u)
            .filter(Boolean);
        for (const word of words) {
            // by character rather than by utf-16 unit, so a character outside the basic plane is one
            const padded: string[] = Array.from(`  ${word} `);
            for (let i: number = 0; i + 3 <= padded.length; i++) {
                res.add(padded.slice(i, i + 3).join(''));
            }
        }
        return res;
    }
}
/**
 * Compares two identifiers of a pre-release, the way SemVer orders them: numbers by their value and
 * before any name, names by their characters.
 * @param a - The one identifier.
 * @param b - The other.
 * @returns Below zero when a comes first, above zero when b does, zero when they are the same.
 */
function compareIdentifiers(a: string, b: string): number {
    const aIsNumber: boolean = /^\d+$/.test(a);
    const bIsNumber: boolean = /^\d+$/.test(b);
    if (aIsNumber && bIsNumber) {
        return Number(a) - Number(b);
    }
    if (aIsNumber !== bIsNumber) {
        return aIsNumber ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compares two versions, the way SemVer orders them.
 * @param a - The one version, as `major.minor.patch` with an optional pre-release.
 * @param b - The other.
 * @returns Below zero when a comes first, above zero when b does, zero when they are the same.
 */
function compareVersions(a: string, b: string): number {
    const [aRelease = '', ...aRest]: string[] = a.split('-');
    const [bRelease = '', ...bRest]: string[] = b.split('-');
    const aNumbers: number[] = aRelease.split('.').map(Number);
    const bNumbers: number[] = bRelease.split('.').map(Number);
    for (let index: number = 0; index < 3; index++) {
        const difference: number = (aNumbers[index] ?? 0) - (bNumbers[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    // a pre-release names a hyphen of its own when it holds one, so everything after the first is it
    const aPreRelease: string = aRest.join('-');
    const bPreRelease: string = bRest.join('-');
    // a pre-release comes before the release it leads up to
    if (!aPreRelease.length || !bPreRelease.length) {
        return Number(!aPreRelease.length) - Number(!bPreRelease.length);
    }
    const aIdentifiers: string[] = aPreRelease.split('.');
    const bIdentifiers: string[] = bPreRelease.split('.');
    for (let index: number = 0; index < Math.min(aIdentifiers.length, bIdentifiers.length); index++) {
        const difference: number = compareIdentifiers(aIdentifiers[index] ?? '', bIdentifiers[index] ?? '');
        if (difference !== 0) {
            return difference;
        }
    }
    // the one with more identifiers comes later, when all the ones both have are the same
    return aIdentifiers.length - bIdentifiers.length;
}

/**
 * Whether one version is a later release than another.
 * @param version - The version in question.
 * @param than - The version it is compared to.
 * @returns True when it is later.
 */
export function isLaterVersion(version: string, than: string): boolean {
    return compareVersions(version, than) > 0;
}
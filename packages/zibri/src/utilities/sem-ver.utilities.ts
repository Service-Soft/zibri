import { isNumeric } from './is-numeric.function';
import { InternalError } from '../error-handling/internal-error.model';
import { SemVerMatcher } from '../versioning/supported-versions-options.model';

/**
 * Definition for a SemVer version.
 */
export type SemVerVersion = `${number}.${number}.${number}`;

/**
 * Semver tuple consisting of major, minor and patch.
 */
type SemVerTuple = readonly [number, number, number];

/**
 * A sem ver range, consisting of a min and max version .
 */
type SemVerRangeBounds = {
    /**
     * The minimum sem ver version.
     */
    min: SemVerTuple,
    /**
     * The maximum sem ver version.
     */
    max: SemVerTuple
};

/**
 * Encapsulates functionalities around handling semver versions.
 */
export abstract class SemVerUtilities {
    /**
     * Checks whether the given value is a valid SemVer version.
     * @param value - The value to check.
     * @returns True if the value is in the format "number.number.number", false otherwise.
     */
    static isSemVerVersion(value: string): value is SemVerVersion {
        const parts: string[] = value.split('.');
        if (parts.length !== 3) {
            return false;
        }

        return parts.every(isNumeric);
    }

    /**
     * Compares the given versions and checks if the first one is bigger, equal or smaller than the second one.
     * @param v1 - The first version.
     * @param v2 - The second version to compare against.
     * @returns 'bigger', 'equal' or 'smaller'.
     */
    static compare(v1: SemVerVersion, v2: SemVerVersion): 'bigger' | 'equal' | 'smaller' {
        const result: number = this.compareTuple(this.parseStrict(v1), this.parseStrict(v2));
        if (result > 0) {
            return 'bigger';
        }
        if (result < 0) {
            return 'smaller';
        }
        return 'equal';
    }

    /**
     * Checks if the given semver matcher overlaps with one of the provided matchers.
     * @param version - The version/matcher to check.
     * @param matchers - The matchers to check against.
     * @returns True if the version/matcher overlaps with at least one matcher, false otherwise.
     */
    static matches(version: SemVerMatcher, matchers: SemVerMatcher[]): boolean {
        const versionRange: SemVerRangeBounds = this.toRange(version);
        return matchers.some((matcher: SemVerMatcher) => this.intersects(versionRange, this.toRange(matcher)));
    }

    private static toRange(matcher: SemVerMatcher): SemVerRangeBounds {
        const parts: string[] = matcher.trim().split(/\s+/)
            .filter(Boolean);

        return parts.reduce<SemVerRangeBounds>(
            (acc: SemVerRangeBounds, part: string) => this.intersect(acc, this.atomicRange(part)),
            this.fullRange()
        );
    }

    private static atomicRange(matcher: string): SemVerRangeBounds {
        if (matcher.startsWith('^')) {
            return this.caretRange(matcher.slice(1));
        }

        if (matcher.startsWith('~')) {
            return this.tildeRange(matcher.slice(1));
        }

        if (matcher.startsWith('>=')) {
            return {
                min: this.parseStrict(matcher.slice(2)),
                max: this.infinity()
            };
        }

        if (matcher.startsWith('>')) {
            return {
                min: this.increment(this.parseStrict(matcher.slice(1))),
                max: this.infinity()
            };
        }

        if (matcher.startsWith('<=')) {
            return {
                min: this.zero(),
                max: this.increment(this.parseStrict(matcher.slice(2)))
            };
        }

        if (matcher.startsWith('<')) {
            return {
                min: this.zero(),
                max: this.parseStrict(matcher.slice(1))
            };
        }

        const exact: SemVerTuple = this.parseStrict(matcher);
        return {
            min: exact,
            max: this.increment(exact)
        };
    }

    private static caretRange(raw: string): SemVerRangeBounds {
        const [major, minor, patch] = this.parseLoose(raw);
        const min: SemVerTuple = [major, minor, patch];

        if (major > 0) {
            return {
                min,
                max: [major + 1, 0, 0]
            };
        }

        if (minor > 0) {
            return {
                min,
                max: [0, minor + 1, 0]
            };
        }

        return {
            min,
            max: [0, 0, patch + 1]
        };
    }

    private static tildeRange(raw: string): SemVerRangeBounds {
        const parts: string[] = raw.split('.');

        if (parts.length < 1 || parts.length > 3) {
            throw new InternalError(`Invalid semver matcher: ~${raw}`);
        }

        const [major, minor, patch] = this.parseLoose(raw);
        const min: SemVerTuple = [major, minor, patch];

        if (parts.length >= 2) {
            return {
                min,
                max: [major, minor + 1, 0]
            };
        }

        return {
            min,
            max: [major + 1, 0, 0]
        };
    }

    private static parseStrict(version: string): SemVerTuple {
        if (!this.isSemVerVersion(version)) {
            throw new InternalError(`Invalid semver version: ${version}`);
        }

        const [major, minor, patch] = version.split('.').map(Number);
        return [major, minor, patch];
    }

    private static parseLoose(version: string): SemVerTuple {
        const parts: string[] = version.split('.');

        if (parts.length < 1 || parts.length > 3) {
            throw new InternalError(`Invalid semver matcher: ${version}`);
        }

        const [majorRaw, minorRaw, patchRaw] = parts;

        if (
            !isNumeric(majorRaw)
            || (minorRaw !== undefined && !isNumeric(minorRaw))
            || (patchRaw !== undefined && !isNumeric(patchRaw))
        ) {
            throw new InternalError(`Invalid semver matcher: ${version}`);
        }

        return [
            Number(majorRaw),
            Number(minorRaw ?? 0),
            Number(patchRaw ?? 0)
        ];
    }

    private static compareTuple(a: SemVerTuple, b: SemVerTuple): number {
        if (a[0] > b[0]) {
            return 1;
        }
        if (a[0] < b[0]) {
            return -1;
        }

        if (a[1] > b[1]) {
            return 1;
        }
        if (a[1] < b[1]) {
            return -1;
        }

        if (a[2] > b[2]) {
            return 1;
        }
        if (a[2] < b[2]) {
            return -1;
        }

        return 0;
    }

    private static intersect(a: SemVerRangeBounds, b: SemVerRangeBounds): SemVerRangeBounds {
        return {
            min: this.maxTuple(a.min, b.min),
            max: this.minTuple(a.max, b.max)
        };
    }

    private static intersects(a: SemVerRangeBounds, b: SemVerRangeBounds): boolean {
        return this.compareTuple(this.maxTuple(a.min, b.min), this.minTuple(a.max, b.max)) < 0;
    }

    private static minTuple(a: SemVerTuple, b: SemVerTuple): SemVerTuple {
        return this.compareTuple(a, b) <= 0 ? a : b;
    }

    private static maxTuple(a: SemVerTuple, b: SemVerTuple): SemVerTuple {
        return this.compareTuple(a, b) >= 0 ? a : b;
    }

    private static increment([major, minor, patch]: SemVerTuple): SemVerTuple {
        return [major, minor, patch + 1];
    }

    private static zero(): SemVerTuple {
        return [0, 0, 0];
    }

    private static infinity(): SemVerTuple {
        return [Number.POSITIVE_INFINITY, 0, 0];
    }

    private static fullRange(): SemVerRangeBounds {
        return {
            min: this.zero(),
            max: this.infinity()
        };
    }
}
import { Version } from '../types';

export function compareVersion(v1: Version, v2: Version): 'bigger' | 'equal' | 'smaller' {
    const [v1One, v1Two, v1Three] = v1;
    const [v2One, v2Two, v2Three] = v2;
    if (v1One > v2One) {
        return 'bigger';
    }
    if (v1Two > v2Two) {
        return 'bigger';
    }
    if (v1Three > v2Three) {
        return 'bigger';
    }

    if (v2One > v1One) {
        return 'smaller';
    }
    if (v2Two > v1Two) {
        return 'smaller';
    }
    if (v2Three > v1Three) {
        return 'smaller';
    }

    return 'equal';
}
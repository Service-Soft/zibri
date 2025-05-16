export function isDate(value: unknown): value is Date | string {
    if (value instanceof Date) {
        return true;
    }
    if (typeof value !== 'string') {
        return false;
    }
    const date: Date = new Date(value);
    return !Number.isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+\-]\d{2}:\d{2})?)?$/.test(value);
}
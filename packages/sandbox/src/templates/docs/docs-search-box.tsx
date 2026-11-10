import { $ts, DocsSearchEntry, onClient, Ref, State, TsxComponent, useRef, useState } from 'zibri';

type DocsSearchBoxProps = {
    // where the index of the search is fetched from, once a reader starts to search
    indexAddress: string
};

/**
 * An entry of the search with the words it is found by, each stemmed.
 */
type SearchableEntry = {
    entry: DocsSearchEntry,
    title: string,
    titleWords: string[],
    keywordWords: string[],
    contextWords: string[]
};

// the search of the documentation. `/` focuses it, the arrow keys and Enter choose a result, Escape or a click outside
// closes them. It searches in the browser, so its functions are declared in the component, where client code reads them
export const DocsSearchBox: TsxComponent<DocsSearchBoxProps> = ({ indexAddress }) => {
    const results: State<DocsSearchEntry[]> = useState<DocsSearchEntry[]>([]);
    const active: State<number> = useState(0);
    const box: Ref<HTMLDivElement> = useRef<HTMLDivElement>();
    const input: Ref<HTMLInputElement> = useRef<HTMLInputElement>();
    let searchable: SearchableEntry[] | undefined;

    // a word cut to its stem, so its forms find each other: `entities` and `entity`, `logging`, `logged` and `log`. A
    // stem keeps a vowel, so `string` stays as it is
    function stem(word: string): string {
        if (word.length <= 3) {
            return word;
        }
        if (word.endsWith('ies')) {
            return `${word.slice(0, -3)}y`;
        }
        if (word.endsWith('ing') || word.endsWith('ed')) {
            const rest: string = word.slice(0, word.endsWith('ing') ? -3 : -2);
            // a doubled consonant the suffix added goes with it: logging, log
            return /[aeiouy]/.test(rest) ? rest.replace(/([^aeiouls])\1$/, '$1') : word;
        }
        if (/(?:ss|x|ch|sh)es$/.test(word)) {
            return word.slice(0, -2);
        }
        return word.endsWith('s') && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
    }

    // the words of a text, lowercase, a name written in camel case split into its words
    function splitWords(text: string): string[] {
        return text
            .replaceAll(/([\da-z])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .split(/[^\da-z]+/)
            .filter(word => word !== '');
    }

    // the words typed, each cut to its stem
    function toWords(text: string): string[] {
        return splitWords(text).map(word => stem(word));
    }

    // the words of an entry: each cut to its stem, and as it is written where that differs, so a typo of a word whose
    // stem leaves its ending out, such as `writing` with a letter missing, still finds it
    function toEntryWords(text: string): string[] {
        return splitWords(text).flatMap(word => stem(word) === word ? [word] : [stem(word), word]);
    }

    // how many letters to change, add, remove or swap with the next to turn one word into another
    function resolveDistance(a: string, b: string): number {
        let before: number[] = [];
        let previous: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);
        for (let i: number = 1; i <= a.length; i++) {
            const current: number[] = [i];
            for (let j: number = 1; j <= b.length; j++) {
                const changed: number = a[i - 1] === b[j - 1] ? 0 : 1;
                let distance: number = Math.min((previous[j] ?? i) + 1, (current[j - 1] ?? j) + 1, (previous[j - 1] ?? 0) + changed);
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                    distance = Math.min(distance, (before[j - 2] ?? 0) + 1);
                }
                current[j] = distance;
            }
            before = previous;
            previous = current;
        }
        return previous[b.length] ?? 0;
    }

    // whether the letters of a word typed are in a word in their order, from its first, such as those of a word with
    // letters left out
    function isInOrder(query: string, word: string): boolean {
        let at: number = 0;
        for (const letter of word) {
            if (letter === query[at]) {
                at++;
            }
        }
        return query.length >= 3 && word.startsWith(query[0] ?? '') && at === query.length;
    }

    // how well a word typed finds a word of an entry, from 1 to 0: the same word, the start of it while it is typed, the
    // word or its start with a typo, or its letters in their order. A longer word may have more typos
    function scoreWord(query: string, word: string): number {
        if (word === query) {
            return 1;
        }
        if (query.length >= 2 && word.startsWith(query)) {
            return 0.8;
        }
        const allowed: number = query.length >= 8 ? 2 : query.length >= 4 ? 1 : 0;
        if (allowed > 0 && Math.abs(word.length - query.length) <= allowed && resolveDistance(query, word) <= allowed) {
            return 0.6;
        }
        if (allowed > 0 && word.length > query.length && resolveDistance(query, word.slice(0, query.length)) <= allowed) {
            return 0.4;
        }
        return isInOrder(query, word) ? 0.3 : 0;
    }

    function scoreWords(query: string, words: string[]): number {
        return words.reduce((best, word) => Math.max(best, scoreWord(query, word)), 0);
    }

    // every word typed is to find a word of the entry, best in its title, then in its keywords, then in where it is. A
    // title that is what was typed, or starts with it, is found best, and a page before a section
    function scoreEntry(entry: SearchableEntry, queryWords: string[], query: string): number {
        let total: number = 0;
        for (const queryWord of queryWords) {
            const best: number = Math.max(
                scoreWords(queryWord, entry.titleWords),
                0.9 * scoreWords(queryWord, entry.keywordWords),
                0.3 * scoreWords(queryWord, entry.contextWords)
            );
            if (best === 0) {
                return 0;
            }
            total += best;
        }
        const titleBonus: number = entry.title === query ? 1 : entry.title.startsWith(query) ? 0.5 : 0;
        const pageBonus: number = entry.entry.address.includes('#') ? 0 : 0.25;
        return (total / queryWords.length) + titleBonus + pageBonus;
    }

    // whether what the index answers is the entries it holds
    function isEntries(value: unknown): value is DocsSearchEntry[] {
        return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'object' && entry !== null
            && 'title' in entry && typeof entry.title === 'string'
            && 'address' in entry && typeof entry.address === 'string'
            && 'context' in entry && typeof entry.context === 'string'
            && 'keywords' in entry && Array.isArray(entry.keywords));
    }

    async function load(): Promise<SearchableEntry[]> {
        if (searchable === undefined) {
            const entries: unknown = await (await fetch(indexAddress)).json();
            if (!isEntries(entries)) {
                throw new Error(`${indexAddress} answers no entries of the search.`);
            }
            searchable = entries.map(entry => ({
                entry,
                title: entry.title.toLowerCase(),
                // a name is found by its words, and as a whole while it is typed
                titleWords: [...toEntryWords(entry.title), ...entry.title.includes(' ') ? [] : [entry.title.toLowerCase()]],
                keywordWords: entry.keywords.flatMap(keyword => toEntryWords(keyword)),
                contextWords: toEntryWords(entry.context)
            }));
        }
        return searchable;
    }

    // the ten entries found best, the best first. A small word such as `in` finds every word starting with it, so it
    // only counts when nothing else was typed
    async function search(): Promise<void> {
        const smallWords: string[] = ['a', 'an', 'and', 'at', 'by', 'for', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'with'];
        const query: string = input.current.value;
        const typedWords: string[] = toWords(query);
        const meaningful: string[] = typedWords.filter(word => !smallWords.includes(word));
        const queryWords: string[] = meaningful.length > 0 ? meaningful : typedWords;
        const typed: string = query.trim().toLowerCase();
        const found: DocsSearchEntry[] = queryWords.length === 0
            ? []
            : (await load())
                .map(entry => ({ entry: entry.entry, score: scoreEntry(entry, queryWords, typed) }))
                .filter(scored => scored.score > 0)
                .sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length)
                .slice(0, 10)
                .map(scored => scored.entry);
        // an answer to what was typed before is not shown over what is typed now
        if (input.current.value === query) {
            results.value = found;
            active.value = 0;
        }
    }

    function choose(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp': {
                event.preventDefault();
                const step: number = event.key === 'ArrowDown' ? 1 : -1;
                active.value = Math.min(Math.max(active.value + step, 0), results.value.length - 1);
                break;
            }
            case 'Enter': {
                const chosen: DocsSearchEntry | undefined = results.value[active.value];
                if (chosen !== undefined) {
                    event.preventDefault();
                    results.value = [];
                    location.href = chosen.address;
                }
                break;
            }
            case 'Escape': {
                results.value = [];
                break;
            }
            default: {
                break;
            }
        }
    }

    onClient(() => {
        document.addEventListener('keydown', event => {
            if (event.key === '/' && document.activeElement !== input.current) {
                event.preventDefault();
                input.current.focus();
            }
        });
        document.addEventListener('click', event => {
            if (event.target instanceof Node && !box.current.contains(event.target)) {
                results.value = [];
            }
        });
    });

    return (
        <div ref={box} className="relative">
            <input
                ref={input}
                id="docs-search-input"
                type="search"
                placeholder={$ts`Search`}
                aria-label={$ts`Search the documentation`}
                autocomplete="off"
                className="w-40 sm:w-56 lg:w-72 px-3 py-1.5 rounded-sm border border-primary bg-dark-gray text-sm text-white
                    placeholder:text-disabled focus:outline-none focus:border-secondary"
                onFocus={() => void search()}
                onInput={() => void search()}
                onKeyDown={event => choose(event)}
            />
            {results.value.length > 0 && <ul
                id="docs-search-results"
                aria-label={$ts`Results`}
                className="absolute right-0 top-11 z-20 w-[calc(100vw-2rem)] sm:w-lg max-h-[70vh] overflow-y-auto p-1
                    rounded-md border border-primary bg-dark-gray shadow-elevation"
            >
                {results.value.map((result, index) => <li key={result.address}>
                    <a
                        href={result.address}
                        aria-current={index === active.value ? 'true' : undefined}
                        className={`block px-3 py-2 rounded-sm hover:bg-primary ${index === active.value ? 'bg-primary' : ''}`}
                        onClick={() => {
                            results.value = [];
                        }}
                    >
                        <span className="block truncate text-sm text-white">{result.title}</span>
                        <span className="block truncate text-xs text-disabled">{result.context}</span>
                    </a>
                </li>)}
            </ul>}
        </div>
    );
};
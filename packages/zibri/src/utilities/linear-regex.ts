/**
 * The flags that change what a part of a pattern matches, which a modifier group like `(?i:...)` sets for its part.
 */
type ScopeFlags = {
    /**
     * Whether letters match regardless of their case.
     */
    ignoreCase: boolean,
    /**
     * Whether `^` and `$` match at line terminators as well.
     */
    multiline: boolean,
    /**
     * Whether `.` matches line terminators as well.
     */
    dotAll: boolean
};

/**
 * A position in a parsed pattern: the start or end of the input or of a line, or a word boundary.
 */
type AssertionNode = {
    /**
     * A position.
     */
    type: 'assertion',
    /**
     * Which position.
     */
    assertion: 'start' | 'end' | 'wordBoundary' | 'notWordBoundary',
    /**
     * Whether `^` and `$` match at line terminators as well.
     */
    multiline: boolean,
    /**
     * The matcher saying whether a character counts as one of a word, for a word boundary.
     */
    wordCharacter: number
};

/**
 * A part of a parsed pattern.
 */
type PatternNode = AssertionNode | {
    /**
     * One character: a literal, `.`, an escape or a class.
     */
    type: 'character',
    /**
     * The matcher saying whether a character is matched.
     */
    matcher: number
} | {
    /**
     * Parts one after the other.
     */
    type: 'sequence',
    /**
     * The parts.
     */
    nodes: PatternNode[]
} | {
    /**
     * One of several parts.
     */
    type: 'alternation',
    /**
     * The parts.
     */
    nodes: PatternNode[]
} | {
    /**
     * A part repeated.
     */
    type: 'repetition',
    /**
     * The part.
     */
    node: PatternNode,
    /**
     * How often it repeats at least.
     */
    min: number,
    /**
     * How often it repeats at most, `Infinity` for no limit.
     */
    max: number
};

/**
 * A state of the compiled pattern: an automaton whose states are all followed at once, so that no part of the input
 * is read twice.
 */
type AutomatonState = {
    /**
     * Reads one character and moves to `next`, when the character matches.
     */
    type: 'character',
    /**
     * The matcher saying whether a character is matched.
     */
    matcher: number,
    /**
     * The state after the character.
     */
    next: number
} | {
    /**
     * Moves to `next` without reading, when the position holds.
     */
    type: 'assertion',
    /**
     * The position, as parsed.
     */
    node: AssertionNode,
    /**
     * The state after the position.
     */
    next: number
} | {
    /**
     * Moves to every one of `next` without reading.
     */
    type: 'split',
    /**
     * The states moved to.
     */
    next: number[]
} | {
    /**
     * The pattern matched.
     */
    type: 'match'
};

/**
 * What a character is to a pattern: which of the pattern's matchers match it, and whether it ends a line. Characters
 * with the same signature are read the same by every part of the pattern, so what one of them does to the states
 * followed at once holds for them all.
 */
type CharacterSignature = {
    /**
     * Whether each matcher of the pattern matches the character, by the matcher's number.
     */
    accepts: boolean[],
    /**
     * Whether the character ends a line, for `^` and `$` with the multiline flag.
     */
    lineTerminator: boolean,
    /**
     * What the positions of the pattern read of the character as the one before them: characters with the same key
     * are read the same.
     */
    previousKey: string
};

/**
 * The states of the automaton a step starts from, with the steps from it already taken.
 *
 * All the states of the automaton that are followed at once, read as one: what a character does to them is worked
 * out the first time a character of its signature is read from them, and looked up every time after.
 */
type CombinedState = {
    /**
     * Its number: its row of the table of steps.
     */
    id: number,
    /**
     * The states of the automaton entered by the step before, sorted.
     */
    entries: number[],
    /**
     * The signature of the character before, `NO_CHARACTER` at the start of the value. Any one stands for all of
     * those the positions of the pattern read the same, which are combined in the same state.
     */
    previous: number,
    /**
     * Whether the pattern matches at the end of the value, once it was worked out.
     */
    end: boolean | undefined
};

/**
 * The capturing groups of a pattern, which decide whether `\1` and `\k<name>` are backreferences.
 */
type GroupCount = {
    /**
     * How many capturing groups there are.
     */
    capturing: number,
    /**
     * Whether one of them is named.
     */
    named: boolean
};

/**
 * The signature of no character: the one before the start of the value, and the one after its end.
 */
const NO_CHARACTER: number = -1;

/**
 * Where a step leads once the pattern matched: no states, as nothing is read after it.
 */
const MATCHED: CombinedState = { id: -1, entries: [], previous: NO_CHARACTER, end: true };

/**
 * What the table of steps holds for a step after which the pattern matched. It holds 0 for one not worked out yet,
 * and the number of the states after it plus one for every other.
 */
const MATCHED_STEP: number = -1;

/**
 * How many steps the table may hold, its rows by the signatures, before the pattern forgets them all and works
 * them out again: 16 MiB.
 */
const MAX_TABLE_ENTRIES: number = 1 << 22;

/**
 * How many characters a block of the signatures holds: the code points that share all but their last 8 bits.
 */
const BLOCK_SIZE: number = 0x1_00;

/**
 * What reading a block works in, kept so that reading one allocates only its text and, when its characters do not
 * share one signature, its signatures: the code units of the block's text, a code point taking two above U+FFFF, and
 * the signature of each of its characters. Shared by every pattern, as a block is read in one go.
 */
// a plain array: spread into String.fromCharCode, a typed array goes through its iterator, several times slower
const BLOCK_UNITS: number[] = [];
const BLOCK_SIGNATURES: Uint16Array = new Uint16Array(BLOCK_SIZE);

/**
 * The bits of each character of a block, which grow with the matchers of a pattern.
 */
let blockBits: Int32Array = new Int32Array(BLOCK_SIZE);

/**
 * How many steps a pattern keeps worked out before it forgets them all and works them out again. Bounds the memory a
 * pattern of many states can take, and costs no more than the time of working them out once.
 */
const MAX_COMBINED_STEPS: number = 10_000;

/**
 * The characters that mean something in a pattern, escaped when one of them is matched literally.
 */
const SYNTAX_CHARACTERS: Set<string> = new Set(['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '/']);

/**
 * A pattern compiled to run in time linear to the value it is tested against: an automaton whose states are all
 * followed at once instead of one after another, so that no part of the value is read more than once.
 *
 * Takes the syntax and flags of a RegExp, less the parts no automaton can follow: lookarounds and backreferences.
 * Every single character - a literal, `.`, an escape, a class - is matched by a RegExp of its own that matches one
 * character and nothing else, so what a character matches is what the platform says it does, case folding, unicode
 * properties and class set operations included. Only how the characters are put together is run here.
 *
 * Those RegExps run once per block of 256 code points the first time a character of it is read, and give each of its
 * characters a signature. Testing a value then reads one signature per character and one step per signature, and
 * runs no RegExp: what a block holds is kept for as long as the pattern is, at most two bytes a code point.
 */
export class LinearRegex {
    private readonly states: AutomatonState[] = [];
    private readonly start: number;
    private readonly unicode: boolean;
    // every distinct matcher of the pattern, global so that one search reads every character of a block. And each
    // as one search saying whether it matches any character of a block, and one whether it matches all of them
    private readonly matchers: RegExp[];
    private readonly anyMatchers: RegExp[];
    private readonly allMatchers: RegExp[];
    // what a position like ^ or \b reads of the character before it: whether there is one, whether it ends a line
    // and whether it is a word character, by each set of flags a word boundary is read with
    private readonly readsPrevious: boolean;
    private readonly readsLineTerminator: boolean;
    private readonly wordMatchers: number[];
    private readonly signatures: CharacterSignature[] = [];
    private readonly signatureIds: Map<number | string, number> = new Map();
    // the signature of every character, by the block it is in: one number for a block whose characters share one.
    // And those of ascii on their own, which nearly every character of a value is
    private readonly blocks: (Uint16Array | number | undefined)[] = [];
    private readonly asciiSignatures: Uint16Array = new Uint16Array(0x80);
    private combined: Map<string, CombinedState> = new Map();
    private combinedSteps: number = 0;
    private initial: CombinedState;
    // the states followed at once by their number, and where each character leads from each of them: a row of
    // 2 ** shift entries per state, one per signature, so that a step reads a number and no object
    private stateList: CombinedState[] = [];
    private table: Int32Array = new Int32Array(0);
    private shift: number = 0;
    // which states one step has followed, by the number of the step: kept, so that a step allocates no array for it
    private readonly visited: Int32Array;
    private visitedStep: number = 0;

    /**
     * Compiles a pattern.
     * @param pattern - The pattern, as the source of a RegExp.
     * @param flags - The flags of the RegExp. `g`, `y` and `d` change nothing about whether a value matches.
     * @throws A SyntaxError when the pattern is not one a RegExp takes, or uses a lookaround or a backreference.
     */
    constructor(pattern: string, flags: string) {
        // the platform says whether the pattern is one at all, so what is parsed below is known to be valid
        const platform: RegExp = new RegExp(pattern, flags);
        this.unicode = platform.unicode || platform.flags.includes('v');
        const parser: PatternParser = new PatternParser(platform.source, platform.flags);
        const parsed: PatternNode = parser.parse();
        this.matchers = parser.matchers;
        this.anyMatchers = this.matchers.map(matcher => new RegExp(matcher.source, matcher.flags.replace('g', '')));
        this.allMatchers = this.matchers.map(
            matcher => new RegExp(`^${matcher.source}+$`, matcher.flags.replace('g', ''))
        );
        this.states.push({ type: 'match' });
        this.start = this.compile(parsed, 0);
        const assertions: AssertionNode[] = this.states.flatMap(state => state.type === 'assertion' ? [state.node] : []);
        this.readsPrevious = assertions.some(node => node.assertion !== 'end');
        this.readsLineTerminator = assertions.some(node => node.assertion === 'start' && node.multiline);
        this.wordMatchers = [
            ...new Set(assertions
                .filter(node => node.assertion === 'wordBoundary' || node.assertion === 'notWordBoundary')
                .map(node => node.wordCharacter))
        ];
        this.visited = new Int32Array(this.states.length).fill(-1);
        this.initial = this.resolveCombinedState([], NO_CHARACTER);
        const latin: Uint16Array | number = this.resolveBlock(0);
        for (let code: number = 0; code < 0x80; code++) {
            this.asciiSignatures[code] = typeof latin === 'number' ? latin : latin[code] ?? 0;
        }
    }

    /**
     * Whether the value matches the pattern anywhere, like `RegExp.prototype.test`.
     * @param value - The value.
     * @returns Whether it matches.
     */
    // eslint-disable-next-line sonar/cognitive-complexity
    test(value: string): boolean {
        let state: number = this.initial.id;
        let position: number = 0;
        const length: number = value.length;
        const asciiSignatures: Uint16Array = this.asciiSignatures;
        // read again after every step worked out, which can grow the table or start it over
        let table: Int32Array = this.table;
        let shift: number = this.shift;
        while (position < length) {
            let code: number = value.charCodeAt(position);
            let signature: number;
            if (code < 0x80) {
                signature = asciiSignatures[code] ?? 0;
                position++;
            }
            else {
                let size: number = 1;
                // with the unicode flag, a surrogate pair is one character
                if (this.unicode && code >= 0xD8_00 && code <= 0xDB_FF && position + 1 < length) {
                    const trail: number = value.charCodeAt(position + 1);
                    if (trail >= 0xDC_00 && trail <= 0xDF_FF) {
                        code = ((code - 0xD8_00) << 10) + trail - 0xDC_00 + 0x1_00_00;
                        size = 2;
                    }
                }
                const block: Uint16Array | number = this.blocks[code >> 8] ?? this.resolveBlock(code >> 8);
                signature = typeof block === 'number' ? block : block[code & 0xFF] ?? 0;
                position += size;
                // a block read for the first time can add signatures, which widens the rows
                table = this.table;
                shift = this.shift;
            }
            let next: number = table[(state << shift) + signature] ?? 0;
            if (next === 0) {
                next = this.resolveStep(state, signature);
                table = this.table;
                shift = this.shift;
            }
            if (next === MATCHED_STEP) {
                return true;
            }
            state = next - 1;
        }
        const last: CombinedState = this.stateList[state] ?? this.initial;
        return last.end ?? this.resolveEnd(last);
    }

    /**
     * The signature of every character of a block, worked out with one search of each matcher, and kept.
     * @param block - The block, the code point shifted right by 8 bits.
     * @returns The signatures, or the one signature every character of the block has.
     */
    // eslint-disable-next-line sonar/cognitive-complexity
    private resolveBlock(block: number): Uint16Array | number {
        const first: number = block * BLOCK_SIZE;
        // with the unicode flag a code point, without it a code unit, as a RegExp reads them. As code units in one
        // call, which builds the text some fifty times faster than adding each character to it
        let unitCount: number = 0;
        for (let code: number = first; code < first + BLOCK_SIZE; code++) {
            if (code > 0xFF_FF) {
                BLOCK_UNITS[unitCount++] = 0xD8_00 + ((code - 0x1_00_00) >> 10);
                BLOCK_UNITS[unitCount++] = 0xDC_00 + ((code - 0x1_00_00) & 0x3_FF);
            }
            else {
                BLOCK_UNITS[unitCount++] = code;
            }
        }
        BLOCK_UNITS.length = unitCount;
        const text: string = String.fromCharCode(...BLOCK_UNITS);
        // what each character is to the pattern, as bits: whether it ends a line, then whether each matcher matches
        // it, 32 to a word
        const words: number = Math.ceil((this.matchers.length + 1) / 32);
        if (blockBits.length < BLOCK_SIZE * words) {
            blockBits = new Int32Array(BLOCK_SIZE * words);
        }
        const bits: Int32Array = blockBits;
        bits.fill(0, 0, BLOCK_SIZE * words);
        for (let offset: number = 0; offset < BLOCK_SIZE; offset++) {
            if (this.isLineTerminator(first + offset)) {
                bits[offset * words] = 1;
            }
        }
        for (const [index, matcher] of this.matchers.entries()) {
            const word: number = (index + 1) >> 5;
            const bit: number = 1 << ((index + 1) & 31);
            // most blocks are matched whole or not at all, which one search each says without reading every match
            if (this.anyMatchers[index]?.test(text) !== true) {
                continue;
            }
            if (this.allMatchers[index]?.test(text) === true) {
                for (let offset: number = 0; offset < BLOCK_SIZE; offset++) {
                    bits[(offset * words) + word] = (bits[(offset * words) + word] ?? 0) | bit;
                }
                continue;
            }
            matcher.lastIndex = 0;
            // every match is one character, so no search finds an empty match and stays where it is
            for (let match: RegExpExecArray | null = matcher.exec(text); match != undefined; match = matcher.exec(text)) {
                const offset: number = (this.unicode ? text.codePointAt(match.index) ?? 0 : text.charCodeAt(match.index)) - first;
                bits[(offset * words) + word] = (bits[(offset * words) + word] ?? 0) | bit;
            }
        }
        const ids: Uint16Array = BLOCK_SIGNATURES;
        let uniform: boolean = true;
        for (let offset: number = 0; offset < BLOCK_SIZE; offset++) {
            ids[offset] = words === 1
                ? this.resolveSignature(bits[offset] ?? 0, bits)
                : this.resolveSignature(
                    bits.subarray(offset * words, (offset * words) + words).join(','),
                    bits.slice(offset * words, (offset * words) + words)
                );
            uniform &&= ids[offset] === ids[0];
        }
        // only a block whose characters differ keeps a table of its own
        const resolved: Uint16Array | number = uniform ? ids[0] ?? 0 : ids.slice();
        this.blocks[block] = resolved;
        return resolved;
    }

    private isLineTerminator(code: number): boolean {
        return code === 0x0A || code === 0x0D || code === 0x20_28 || code === 0x20_29;
    }

    /**
     * The number of a signature, the same for every character that has it.
     * @param key - The bits of the character: the one word of them for a pattern of up to 31 matchers, otherwise
     * every word of them, joined.
     * @param bits - The bits as words, read only for a signature not seen before: whether the character ends a line,
     * then whether each matcher matches it. For a key of one word, a first word holding the key.
     * @returns The number.
     */
    private resolveSignature(key: number | string, bits: Int32Array): number {
        const known: number | undefined = this.signatureIds.get(key);
        if (known != undefined) {
            return known;
        }
        const words: Int32Array = typeof key === 'number' ? Int32Array.of(key) : bits;
        const isSet: (position: number) => boolean = position => ((words[position >> 5] ?? 0) & (1 << (position & 31))) !== 0;
        const accepts: boolean[] = this.matchers.map((_, index) => isSet(index + 1));
        const lineTerminator: boolean = isSet(0);
        const line: string = this.readsLineTerminator && lineTerminator ? 'line' : 'character';
        const previousKey: string = `${line}${this.wordMatchers.map(matcher => accepts[matcher] === true ? 1 : 0).join('')}`;
        const id: number = this.signatures.push({ accepts, lineTerminator, previousKey }) - 1;
        this.signatureIds.set(key, id);
        this.resizeTable();
        return id;
    }

    /**
     * Works out what reading a character does to the states followed at once, and keeps it in the table.
     * @param state - The number of the states the character is read from.
     * @param signature - The character's signature.
     * @returns What the table holds for the step: the number of the states after it plus one, or `MATCHED_STEP`.
     */
    private resolveStep(state: number, signature: number): number {
        let from: CombinedState = this.stateList[state] ?? this.initial;
        if (this.combinedSteps >= MAX_COMBINED_STEPS || this.table.length > MAX_TABLE_ENTRIES) {
            this.forgetSteps();
            // numbered anew, as every state is after the table started over
            from = this.resolveCombinedState(from.entries, from.previous);
        }
        this.combinedSteps++;
        const next: CombinedState = this.takeStep(from, signature);
        const step: number = next === MATCHED ? MATCHED_STEP : next.id + 1;
        this.table[(from.id << this.shift) + signature] = step;
        return step;
    }

    /**
     * Works out whether the pattern matches at the end of the value, and keeps it.
     * @param state - The states followed at once at the end.
     * @returns Whether it matches.
     */
    private resolveEnd(state: CombinedState): boolean {
        const matched: boolean = this.takeStep(state, NO_CHARACTER) === MATCHED;
        state.end = matched;
        return matched;
    }

    private forgetSteps(): void {
        this.combined = new Map();
        this.combinedSteps = 0;
        this.stateList = [];
        this.table = new Int32Array(0);
        this.initial = this.resolveCombinedState([], NO_CHARACTER);
    }

    /**
     * Grows the table of steps to hold a row for every state, and an entry in each row for every signature.
     */
    private resizeTable(): void {
        let shift: number = this.shift;
        while (1 << shift < this.signatures.length) {
            shift++;
        }
        const rows: number = this.stateList.length;
        if (shift === this.shift && rows << shift <= this.table.length) {
            return;
        }
        const table: Int32Array = new Int32Array(Math.max(rows * 2, 16) << shift);
        const keptRows: number = this.table.length >> this.shift;
        for (let row: number = 0; row < keptRows; row++) {
            table.set(this.table.subarray(row << this.shift, (row + 1) << this.shift), row << shift);
        }
        this.table = table;
        this.shift = shift;
    }

    /**
     * Works out what reading a character does to the states followed at once: every move that reads nothing first,
     * then the character.
     * @param state - The states the character is read from.
     * @param signature - The character's signature, or `NO_CHARACTER` at the end of the value.
     * @returns The states after it, or `MATCHED` when the pattern matched before it. At the end of the value, the
     * states given when it did not.
     */
    private takeStep(state: CombinedState, signature: number): CombinedState {
        const visit: number = ++this.visitedStep;
        // the start joins at every position, since a match can begin at any of them
        const pending: number[] = [...state.entries, this.start];
        const reading: number[] = [];
        while (pending.length > 0) {
            const index: number = pending.pop() ?? 0;
            if (this.visited[index] === visit) {
                continue;
            }
            this.visited[index] = visit;
            const automatonState: AutomatonState | undefined = this.states[index];
            switch (automatonState?.type) {
                case 'match': {
                    return MATCHED;
                }
                case 'character': {
                    reading.push(index);
                    break;
                }
                case 'split': {
                    pending.push(...automatonState.next);
                    break;
                }
                case 'assertion': {
                    if (this.holds(automatonState.node, state.previous, signature)) {
                        pending.push(automatonState.next);
                    }
                    break;
                }
                case undefined: {
                    break;
                }
            }
        }
        if (signature === NO_CHARACTER) {
            return state;
        }
        const accepts: boolean[] = this.signatures[signature]?.accepts ?? [];
        const entries: Set<number> = new Set();
        for (const index of reading) {
            const automatonState: AutomatonState | undefined = this.states[index];
            if (automatonState?.type === 'character' && accepts[automatonState.matcher] === true) {
                entries.add(automatonState.next);
            }
        }
        return this.resolveCombinedState([...entries].sort((a, b) => a - b), signature);
    }

    /**
     * The states followed at once for the states entered after a character, the same object every time they are
     * entered together after a character the positions of the pattern read the same.
     * @param entries - The states entered, sorted.
     * @param previous - The signature of the character read, `NO_CHARACTER` at the start of the value.
     * @returns The states followed at once.
     */
    private resolveCombinedState(entries: number[], previous: number): CombinedState {
        const previousKey: string = previous === NO_CHARACTER ? 'start' : this.signatures[previous]?.previousKey ?? '';
        const key: string = `${entries.join(',')}|${this.readsPrevious ? previousKey : ''}`;
        const known: CombinedState | undefined = this.combined.get(key);
        if (known != undefined) {
            return known;
        }
        const state: CombinedState = {
            id: this.stateList.length,
            entries,
            previous: this.readsPrevious ? previous : NO_CHARACTER,
            end: undefined
        };
        this.stateList.push(state);
        this.combined.set(key, state);
        this.resizeTable();
        return state;
    }

    /**
     * Adds the states of a part, leading to the state given.
     * @param node - The part.
     * @param next - The state after it.
     * @returns The state the part starts at.
     */
    private compile(node: PatternNode, next: number): number {
        switch (node.type) {
            case 'character': {
                return this.states.push({ type: 'character', matcher: node.matcher, next }) - 1;
            }
            case 'assertion': {
                return this.states.push({ type: 'assertion', node, next }) - 1;
            }
            case 'sequence': {
                return node.nodes.reduceRight((after, part) => this.compile(part, after), next);
            }
            case 'alternation': {
                return this.states.push({ type: 'split', next: node.nodes.map(part => this.compile(part, next)) }) - 1;
            }
            case 'repetition': {
                let after: number = next;
                if (node.max === Infinity) {
                    const loop: number = this.states.push({ type: 'split', next: [] }) - 1;
                    this.states[loop] = { type: 'split', next: [this.compile(node.node, loop), next] };
                    after = loop;
                }
                else {
                    // each optional repetition may stop the ones after it, (x(x)?)? rather than x?x?
                    for (let optional: number = 0; optional < node.max - node.min; optional++) {
                        after = this.states.push({ type: 'split', next: [this.compile(node.node, after), next] }) - 1;
                    }
                }
                for (let required: number = 0; required < node.min; required++) {
                    after = this.compile(node.node, after);
                }
                return after;
            }
        }
    }

    /**
     * Whether a position holds between two characters.
     * @param node - The position, as parsed.
     * @param previous - The signature of the character before it, `NO_CHARACTER` at the start of the value.
     * @param signature - The signature of the character after it, `NO_CHARACTER` at the end of the value.
     * @returns Whether it holds.
     */
    private holds(node: AssertionNode, previous: number, signature: number): boolean {
        const before: CharacterSignature | undefined = this.signatures[previous];
        const after: CharacterSignature | undefined = this.signatures[signature];
        switch (node.assertion) {
            case 'start': {
                return previous === NO_CHARACTER || (node.multiline && before?.lineTerminator === true);
            }
            case 'end': {
                return signature === NO_CHARACTER || (node.multiline && after?.lineTerminator === true);
            }
            case 'wordBoundary':
            case 'notWordBoundary': {
                const wordBefore: boolean = before?.accepts[node.wordCharacter] === true;
                const wordAfter: boolean = after?.accepts[node.wordCharacter] === true;
                return (wordBefore !== wordAfter) === (node.assertion === 'wordBoundary');
            }
        }
    }
}

/**
 * Reads a pattern a RegExp already took into its parts.
 */
class PatternParser {
    /**
     * Every distinct matcher the pattern's characters are matched by, by its number.
     */
    readonly matchers: RegExp[] = [];
    private readonly matcherIds: Map<string, number> = new Map();
    private position: number = 0;
    private readonly unicode: boolean;
    private readonly unicodeSets: boolean;
    private readonly groups: GroupCount;

    constructor(private readonly pattern: string, private readonly flags: string) {
        this.unicodeSets = flags.includes('v');
        this.unicode = this.unicodeSets || flags.includes('u');
        this.groups = this.countGroups();
    }

    /**
     * The whole pattern, parsed.
     * @returns Its parts.
     */
    parse(): PatternNode {
        return this.parseAlternation({
            ignoreCase: this.flags.includes('i'),
            multiline: this.flags.includes('m'),
            dotAll: this.flags.includes('s')
        });
    }

    private parseAlternation(scope: ScopeFlags): PatternNode {
        const nodes: PatternNode[] = [this.parseSequence(scope)];
        while (this.pattern[this.position] === '|') {
            this.position++;
            nodes.push(this.parseSequence(scope));
        }
        return nodes.length === 1 ? nodes[0] ?? { type: 'sequence', nodes: [] } : { type: 'alternation', nodes };
    }

    private parseSequence(scope: ScopeFlags): PatternNode {
        const nodes: PatternNode[] = [];
        while (this.position < this.pattern.length && this.pattern[this.position] !== '|' && this.pattern[this.position] !== ')') {
            nodes.push(this.parseQuantifier(this.parseTerm(scope)));
        }
        return { type: 'sequence', nodes };
    }

    /**
     * One term: a character, a group or a position.
     * @param scope - The flags the term is read with.
     * @returns The term.
     */
    private parseTerm(scope: ScopeFlags): PatternNode {
        const character: string = this.pattern[this.position] ?? '';
        switch (character) {
            case '^':
            case '$': {
                this.position++;
                return this.createAssertion(character === '^' ? 'start' : 'end', scope);
            }
            case '(': {
                return this.parseGroup(scope);
            }
            case '[': {
                return this.createCharacter(this.readClass(), scope);
            }
            case '.': {
                this.position++;
                return this.createCharacter('.', scope);
            }
            case '\\': {
                return this.parseEscape(scope);
            }
            default: {
                return this.createCharacter(this.escapeLiteral(this.readLiteral()), scope);
            }
        }
    }

    private parseGroup(scope: ScopeFlags): PatternNode {
        const rest: string = this.pattern.slice(this.position);
        if (/^\(\?(?:[=!]|<[=!])/.test(rest)) {
            throw new SyntaxError('A lookaround cannot run in time linear to the value.');
        }
        let inner: ScopeFlags = scope;
        const modifiers: RegExpExecArray | null = /^\(\?([ims]*)(?:-([ims]*))?:/.exec(rest);
        const named: RegExpExecArray | null = /^\(\?<[^>]+>/.exec(rest);
        if (modifiers != undefined) {
            inner = this.applyModifiers(scope, modifiers[1] ?? '', modifiers[2] ?? '');
            this.position += modifiers[0].length;
        }
        else if (named != undefined) {
            this.position += named[0].length;
        }
        else {
            this.position++;
        }
        const node: PatternNode = this.parseAlternation(inner);
        // the closing parenthesis
        this.position++;
        return node;
    }

    private applyModifiers(scope: ScopeFlags, added: string, removed: string): ScopeFlags {
        const resolve: (flag: string, current: boolean) => boolean = (flag, current) => {
            if (added.includes(flag)) {
                return true;
            }
            return removed.includes(flag) ? false : current;
        };
        return {
            ignoreCase: resolve('i', scope.ignoreCase),
            multiline: resolve('m', scope.multiline),
            dotAll: resolve('s', scope.dotAll)
        };
    }

    private parseEscape(scope: ScopeFlags): PatternNode {
        const next: string = this.pattern[this.position + 1] ?? '';
        if (next === 'b' || next === 'B') {
            this.position += 2;
            return this.createAssertion(next === 'b' ? 'wordBoundary' : 'notWordBoundary', scope);
        }
        if (/[1-9]/.test(next)) {
            return this.parseDecimalEscape(scope);
        }
        if (next === 'k' && (this.unicode || this.groups.named)) {
            throw new SyntaxError('A backreference cannot run in time linear to the value.');
        }
        return this.createCharacter(this.readEscape(), scope);
    }

    /**
     * `\1` and the like: a backreference when there are as many groups, and otherwise, without the unicode flag, an
     * octal escape or the digit itself.
     * @param scope - The flags the escape is read with.
     * @returns The character the escape stands for.
     * @throws A SyntaxError when the escape is a backreference, which cannot run in time linear to the value.
     */
    private parseDecimalEscape(scope: ScopeFlags): PatternNode {
        const digits: string = /^\d+/.exec(this.pattern.slice(this.position + 1))?.[0] ?? '';
        if (this.unicode || Number(digits) <= this.groups.capturing) {
            throw new SyntaxError('A backreference cannot run in time linear to the value.');
        }
        const octal: string = /^(?:[0-3][0-7]{0,2}|[4-7][0-7]?)/.exec(digits)?.[0] ?? digits.slice(0, 1);
        const source: string = `\\${octal}`;
        this.position += source.length;
        return this.createCharacter(source, scope);
    }

    /**
     * An escape that stands for one character or a class of them, as written.
     * @returns The escape.
     */
    private readEscape(): string {
        const rest: string = this.pattern.slice(this.position);
        const patterns: RegExp[] = this.unicode
            ? [
                /^\\u[\dA-Fa-f]{4}\\u[\dA-Fa-f]{4}/,
                /^\\u\{[\dA-Fa-f]+\}/,
                /^\\u[\dA-Fa-f]{4}/,
                /^\\x[\dA-Fa-f]{2}/,
                /^\\[pP]\{[^}]*\}/,
                /^\\c[A-Za-z]/
            ]
            : [/^\\u[\dA-Fa-f]{4}/, /^\\x[\dA-Fa-f]{2}/, /^\\c[A-Za-z]/, /^\\0[0-7]{0,2}/];
        for (const escape of patterns) {
            const read: string | undefined = escape.exec(rest)?.[0];
            if (read == undefined) {
                continue;
            }
            // two escaped surrogates are one character when they are a pair, and two otherwise
            if (read.length === 12 && !this.isSurrogatePair(read)) {
                continue;
            }
            this.position += read.length;
            return read;
        }
        if (!this.unicode && rest[1] === 'c') {
            // a `\c` not followed by a letter is the backslash itself, and the `c` is read after it
            this.position++;
            return '\\\\';
        }
        this.position += 2;
        return rest.slice(0, 2);
    }

    private isSurrogatePair(escapes: string): boolean {
        const lead: number = Number.parseInt(escapes.slice(2, 6), 16);
        const trail: number = Number.parseInt(escapes.slice(8, 12), 16);
        return lead >= 0xD8_00 && lead <= 0xDB_FF && trail >= 0xDC_00 && trail <= 0xDF_FF;
    }

    /**
     * A class as written, from its `[` to its `]`. Classes nest with the `v` flag.
     * @returns The class.
     */
    private readClass(): string {
        const start: number = this.position;
        let depth: number = 0;
        while (this.position < this.pattern.length) {
            const character: string = this.pattern[this.position] ?? '';
            if (character === '\\') {
                this.position += 2;
                continue;
            }
            this.position++;
            if (character === '[' && (depth === 0 || this.unicodeSets)) {
                depth++;
            }
            else if (character === ']') {
                depth--;
                if (depth === 0) {
                    break;
                }
            }
        }
        return this.pattern.slice(start, this.position);
    }

    /**
     * One literal character: a code point with the unicode flag, a code unit without.
     * @returns The character.
     */
    private readLiteral(): string {
        const length: number = this.unicode && (this.pattern.codePointAt(this.position) ?? 0) > 0xFF_FF ? 2 : 1;
        const literal: string = this.pattern.slice(this.position, this.position + length);
        this.position += length;
        return literal;
    }

    private escapeLiteral(literal: string): string {
        return SYNTAX_CHARACTERS.has(literal) ? `\\${literal}` : literal;
    }

    private parseQuantifier(node: PatternNode): PatternNode {
        const quantifier: RegExpExecArray | null = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})\??/.exec(this.pattern.slice(this.position));
        if (quantifier == undefined) {
            return node;
        }
        this.position += quantifier[0].length;
        switch (quantifier[1]) {
            case '*': {
                return { type: 'repetition', node, min: 0, max: Infinity };
            }
            case '+': {
                return { type: 'repetition', node, min: 1, max: Infinity };
            }
            case '?': {
                return { type: 'repetition', node, min: 0, max: 1 };
            }
            case undefined:
            default: {
                const min: number = Number(quantifier[2]);
                if (quantifier[3] == undefined) {
                    return { type: 'repetition', node, min, max: min };
                }
                return { type: 'repetition', node, min, max: quantifier[4] === '' ? Infinity : Number(quantifier[4]) };
            }
        }
    }

    /**
     * One character, matched by a RegExp that matches that character and nothing else.
     * @param source - The character as written: a literal, `.`, an escape or a class.
     * @param scope - The flags it is read with.
     * @returns The character.
     * @throws A SyntaxError for a class that matches strings of several characters, which the `v` flag allows.
     */
    private createCharacter(source: string, scope: ScopeFlags): PatternNode {
        // a class only takes a complement when every string in it is a single character
        if (this.unicodeSets && (source.startsWith('[') || source.startsWith('\\p')) && this.findRegExp(`[^${source}]`, 'v') == undefined) {
            throw new SyntaxError(
                `${source} matches strings of several characters, which a pattern matching one character at a time cannot read.`
            );
        }
        return { type: 'character', matcher: this.resolveMatcher(source, scope) };
    }

    private findRegExp(source: string, flags: string): RegExp | undefined {
        try {
            return new RegExp(source, flags);
        }
        catch {
            return undefined;
        }
    }

    private createAssertion(assertion: AssertionNode['assertion'], scope: ScopeFlags): AssertionNode {
        return { type: 'assertion', assertion, multiline: scope.multiline, wordCharacter: this.resolveMatcher(String.raw`\w`, scope) };
    }

    /**
     * The number of the matcher of one character, the same for every character written the same with the same flags.
     * @param source - The character as written.
     * @param scope - The flags it is read with.
     * @returns The matcher's number.
     */
    private resolveMatcher(source: string, scope: ScopeFlags): number {
        const flags: string = [
            scope.ignoreCase ? 'i' : '',
            scope.dotAll ? 's' : '',
            this.unicodeSets ? 'v' : '',
            this.unicode && !this.unicodeSets ? 'u' : ''
        ].join('');
        const key: string = `${flags}/${source}`;
        const known: number | undefined = this.matcherIds.get(key);
        if (known != undefined) {
            return known;
        }
        const id: number = this.matchers.push(new RegExp(`(?:${source})`, `${flags}g`)) - 1;
        this.matcherIds.set(key, id);
        return id;
    }

    /**
     * The capturing groups of the pattern.
     * @returns How many there are, and whether one is named.
     */
    private countGroups(): GroupCount {
        let capturing: number = 0;
        let named: boolean = false;
        let depth: number = 0;
        for (let index: number = 0; index < this.pattern.length; index++) {
            const character: string = this.pattern[index] ?? '';
            if (character === '\\') {
                index++;
            }
            else if (character === '[' && (depth === 0 || this.unicodeSets)) {
                depth++;
            }
            else if (character === ']' && depth > 0) {
                depth--;
            }
            else if (character === '(' && depth === 0) {
                const rest: string = this.pattern.slice(index + 1, index + 3);
                if (!rest.startsWith('?')) {
                    capturing++;
                }
                else if (rest.startsWith('?<') && !/^\?<[=!]/.test(this.pattern.slice(index + 1, index + 4))) {
                    capturing++;
                    named = true;
                }
            }
        }
        return { capturing, named };
    }
}
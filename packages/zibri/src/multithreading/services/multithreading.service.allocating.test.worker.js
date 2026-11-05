// Fixture: allocates on the heap until something stops it. With a resource limit on the worker that is
// the worker being ended for its memory; without one it is the process.
//
// Plain objects rather than buffers, because a buffer's memory lives outside the heap the limit is on.
const held = [];

while (true) {
    held.push(Array.from({ length: 100_000 }, () => ({})));
}
// Fixture: throws from a timer, where nothing in the worker can catch it - the file has already
// been required and returned by then, so importWorkerFile's try/catch is long gone and the
// uncaughtException handler is the only thing left that sees it.
setTimeout(() => {
    throw new Error('worker fixture: thrown where nothing can catch it');
});
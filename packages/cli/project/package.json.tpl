{
    "name": "{{name}}",
    "version": "1.0.0",
    "main": "./dist/index.js",
    "scripts": {
        "start": "webpack --watch",
        "build": "webpack",
        "test": "jest",
        "migrate:list": "node dist/index.js migrate list",
        "migrate:down": "node dist/index.js migrate down"
    },
{{! the rest of what "npm init" writes, in the order it writes it. npm warns about every one of these
    a package.json leaves out, and "description" is read by anything that lists the project - so they
    belong in the file even while they are still empty }}
    "keywords": ["zibri"],
    "author": {{author}},
    "license": "MIT",
    "description": ""
}

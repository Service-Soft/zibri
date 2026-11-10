{
    "name": "{{name}}",
    "version": "1.0.0",
    "main": "./dist/bundle.js",
    "scripts": {
        "start": "webpack --watch",
        "build": "webpack",
        "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js",
        "migrate:list": "node dist/bundle.js migrate list",
        "migrate:down": "node dist/bundle.js migrate down"
    },
{{! the rest of what "npm init" writes, in the order it writes it. npm warns about every one of these
    a package.json leaves out, and "description" is read by anything that lists the project - so they
    belong in the file even while they are still empty }}
    "keywords": ["zibri"],
    "author": {{author}},
    "license": "MIT",
    "description": ""
}

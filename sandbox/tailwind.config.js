// eslint-disable-next-line jsdoc/require-description
/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/templates/**/*.{tsx,hbs}'],
    theme: {
        colors: {
            primary: '#0e456f',
            // eslint-disable-next-line cspell/spellchecker
            white: 'whitesmoke',
            secondary: '#00b4d8',
            gray: '#2a2a35',
            'dark-gray': '#1a1a26',
            disabled: 'lightgrey',
            'disabled-dark': 'grey'
        },
        boxShadow: {
            elevation: '0px 5px 5px -3px rgba(0,0,0,0.2), 0px 8px 10px 1px rgba(0,0,0,0.14), 0px 3px 14px 2px rgba(0,0,0,0.12)'
        }
    },
    plugins: []
};
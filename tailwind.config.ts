import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /*
       * The app's palette, named.
       *
       * These eleven values carried about 165 of the ~200 arbitrary colour utilities in the
       * components -- `text-[#8e8e93]` alone appeared 52 times. Written out at each use site
       * they could not be changed in one place and could not be checked against each other, and
       * near-misses (#2c2c2e against #2b2f3a) were invisible in review.
       *
       * The names say what the colour is *for*, not what it looks like, so a future change of
       * hue does not leave every class in the app lying about itself.
       */
      colors: {
        bg: '#080b12',

        // Text, iOS label hierarchy
        muted: '#98989f',       // secondary label -- subtitles, units, inactive glyphs
        quiet: '#bababa',       // the terminal's list greys -- prices, times, L/H, change
        faint: '#5c5c5e',       // tertiary label -- placeholders, disabled, arrow separators
        chartlabel: '#d1d4dc',  // the chart toolbar's own grey, lighter than the list greys

        // Surfaces
        surface: '#1c1c1e',     // cards, sheets, elevated rows
        'surface-2': '#2c2c2e', // menus and dividers over a surface
        'surface-3': '#3a3a3c', // pressed and inert control fills
        hairline: '#38383a',    // the settings separator

        // Semantic
        accent: '#0A84FF',      // links, active state, the winning side
        'accent-ios': '#007AFF',// the older system blue, used by the community tiles
        danger: '#F04534',      // destructive actions, the losing side -- the terminal's red
        success: '#30D158',
      },
      fontFamily: {
        // MT5's second face; the first is the system font, inherited from :root.
        'mt5-cond': ['var(--font-mt5-condensed)', 'Roboto Condensed', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;

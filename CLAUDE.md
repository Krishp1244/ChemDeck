# ChemDeck

A vanilla HTML/CSS/JS flashcard app (Firebase auth + Firestore sync, canvas drawing on cards). No build step, no framework.

## Design & UI/UX rules

Default AI-generated UI tends toward a recognizable "vibe coding" look — this project should not have it. Follow these deliberately:

- **No gradients.** Use flat, solid colors. The palette is navy (`--accent`) and orange (`--accent-2`) — see `:root` in `style.css`. Depth comes from shadow/border, not color blending.
- **No centered hero / no dead-center symmetric layouts.** Prefer off-center, asymmetric composition for hero and landing-style sections. Centered-everything is the default AI tell — avoid it.
- **No Tailwind.** This project uses plain, hand-written CSS in `style.css` with CSS custom properties. Keep it that way — don't introduce a utility-class framework.
- Aim for a considered, professional UI/UX feel over a generic template look: intentional spacing and hierarchy, restrained color use, real typographic choices — not defaults.
- **No em dashes in UI copy.** Use periods, commas, or parentheses instead.
- **One brand lockup everywhere.** The ChemDeck mark is the card-stack icon (three stacked cards, benzene ring with COOH, orange squiggle, pencil), defined once per page as an inline `<symbol id="cd-mark">` sprite just inside `<body>` and drawn with `<svg class="header-logo" viewBox="4 9 96 77"><use href="#cd-mark" /></svg>`. The lockup is that mark plus the wordmark: `.brand-lockup` > `svg.header-logo` + `span.logo-text`. Reuse it on every surface (header, login, consent cards, maintenance, terms) and size it with a per-surface modifier class setting `height` with `width: auto`, never by restyling `.logo-text` itself.
- The mark themes itself: navy strokes are `currentColor` (so `color: var(--accent)` drives it), the card face is `var(--bg-card)` and the accent is `var(--accent-2)`. Custom properties inherit through `<use>`, so don't hard-code colors in the symbol. The favicons are the only hard-coded copies (data URIs in each `<head>`, one per theme). The raster `logo-full.png` is retired.
- Status/empty-state screens (login, maintenance, etc.) should feel like one family: reuse the same card chrome, the brand lockup, and a light, slightly funny tone in the copy rather than dry system-message wording.

## Notes

- Plain glyph icons (`‹ › ✕ ✏ ↺ ＋`) are used in place of emoji throughout the UI — keep this convention, don't reintroduce emoji.
- Theme (light/dark) is controlled via `data-theme` attribute + CSS custom properties, initialized pre-paint by `theme-init.js` to avoid flash of wrong theme.

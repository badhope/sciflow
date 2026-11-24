# Brand guidelines

**English** · [简体中文](BRAND.zh-CN.md)

SciFlow should read as an AI-native research assistant, not as another AI chat product.
The visual language is quiet, editorial and a little tactile: paper, ink and a
cinnabar seal.

## Identity

- **Paper** is the default surface: warm off-white `#f5f4f0`, not pure white.
- **Ink** is the text colour: `#262b33` on light, `#e6e4de` on dark.
- **Dai blue** is the working accent: `#47719e` at the mid step, with
  `#7090b4`, `#2f5480` and `#234367` around it.
- **Cinnabar** is the signature: `#be3b2a` on light, `#d4674f` on dark. It marks
  the seal, the corner and the Flow wordmark, not whole buttons.
- The dark surface is `#101318`.

## Logo

**朱印 3.0 · 回锋** (2026-11-25). The mark is one continuous return-stroke S
with a cinnabar corner: the stroke moves forward, turns at the evidence, and
comes back before it finishes. It is set in a flat cinnabar seal when used as an
app icon. There is no gradient, orbit, node ring or sparkle in the mark itself.

The master files live in `docs/brand/`:

- `icon-master.svg` — 1024×1024 app icon source, with a debossed seal frame
- `logo-mark.svg` — light-background mark, Dai-blue stroke + cinnabar corner
- `logo-mark-light.svg` — dark-background mark, paper-white stroke + lit cinnabar
- `logo-horizontal.svg` — seal, wordmark and tagline for light backgrounds
- `logo-horizontal-light.svg` — the same lockup for dark backgrounds
- `readme-hero.svg` — 1280×420 README hero
- `readme-loop.svg` — 1200×300 six-node research loop

Do not redraw or recollect the bitmaps. PNG, ICO and ICNS files are generated
from the master.

## Rules

- No rainbow gradients, glassmorphism or permanent glow. Two-step tonal shifts
  are allowed on controls; the seal itself is a flat cinnabar fill.
- No orbital rings, nodes or generic AI sparkles. The mark is a stroke and a
  corner, nothing else.
- Use the logo on a clear background with generous space. Do not stretch, rotate
  or recolour it outside the token palette.
- Keep body text at a comfortable reading size; the UI is a tool, not a poster.

## Type and components

The UI uses a system UI stack for controls and a serif for editorial accents.
Existing component classes (`brand-logo`, `brand-btn`, `nav-active`,
`card-lift`, `input-focus-ring`) carry the visual contract. New components should
reuse the CSS variables rather than hard-code colours.

Motion is short and functional: 120–220 ms for state changes, no looping
decoration. The running-state breathing dot is the only persistent animation.

## Voice

Write like a competent colleague: direct, specific, no marketing superlatives.
Say what the tool does, what it will not do, and what the user needs to provide.
Error messages should explain the next action, not blame the user.

## Applying the brand

Web, desktop, docs and release assets all use the same tokens. A brand change
starts from the token table in `apps/web/src/index.css`, then updates the master
SVG, runs `pnpm icons`, and updates this page. The full Chinese guide has the
historical rationale and the complete token table: [BRAND.zh-CN.md](BRAND.zh-CN.md).

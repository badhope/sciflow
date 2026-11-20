# Brand guidelines

**English** · [简体中文](BRAND.zh-CN.md)

SciFlow should read as a research workbench, not as another AI chat product.
The visual language is quiet, editorial and a little tactile: paper, ink and a
cinnabar seal.

## Identity

- **Paper** is the default surface: warm off-white `#f5f4f0`, not pure white.
- **Ink** is the text colour: `#262b33` on light, `#e6e4de` on dark.
- **Dai blue** is the working accent: `#47719e` at the mid step, with
  `#7090b4`, `#2f5480` and `#234367` around it.
- **Cinnabar** is the signature: `#be3b2a` on light, `#d4674f` on dark. It marks
  the seal, the dot and the Flow wordmark, not whole buttons.
- The dark surface is `#101318`.

## Logo

The mark is a single ink stroke with a cinnabar dot, enclosed by a seal when used
as an app icon. The master files live in `docs/brand/`:

- `icon-master.svg` — 1024×1024 app icon source
- `logo-mark.svg` — light-background mark
- `logo-mark-light.svg` — mark for dark or photographic backgrounds
- `logo-horizontal.svg` — seal, wordmark and tagline

Do not redraw or recollect the bitmaps. PNG, ICO and ICNS files are generated
from the master.

## Rules

- No rainbow gradients, glassmorphism or permanent glow. The brand gradient is a
  two-step tonal shift that reads as a flat fill.
- No orbital rings, nodes or generic AI sparkles.
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
SVG and this page. The full Chinese guide has the historical rationale and the
complete token table: [BRAND.zh-CN.md](BRAND.zh-CN.md).

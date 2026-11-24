# Undercurrent design system

The product is **Undercurrent**. The look follows Wise ("deep moss with lime voltage"): a light, flat, confident UI with Forest Ink as the brand's weight, one Lime Voltage accent as punctuation, pill-shaped controls, and heavy, wide display type used sparingly.

Tokens live in `app/globals.css`. Primitives live in `components/ui/*`. Use them; don't hard-code hex values in components except in SVG/canvas code, where you should import `VERDICT_COLORS` / `VERDICT_INK` from `components/ui/verdict-chip.tsx`.

## Color

| Token (Tailwind) | Hex | Use |
|---|---|---|
| `bg-canvas` / `bg-paper` | `#ffffff` | Page canvas, cards placed on fog or linen |
| `bg-recessed` | `#f2f4f0` | Quiet panels and wells on the white canvas |
| `bg-raised` / `bg-fog` | `#e8ebe6` | Fog: section bands, toolbar chips, inactive segments |
| `bg-raised-hover` / `bg-linen` | `#e2f6d5` | Linen Mist: hover, selected rows, soft highlight |
| `bg-lime` | `#9fe870` | Primary CTA fill and the ONE active state per section |
| `bg-forest` | `#163300` | Inverted sections, dark CTA cards (the app top nav stays white) |
| `bg-spruce` | `#054d28` | Card surfaces inside forest sections |
| `text-strong` | `#0e0f0c` | Headings, key numbers |
| `text-body` | `#454745` | Body copy |
| `text-muted` | `#6a6c6a` | Helper text, labels, metadata |
| `text-pebble` | `#868685` | Placeholders and disabled only (too light for real text) |
| `text-lichen` = `text-forest` | `#163300` | Brand-colored text, links, icons, emphasis on light surfaces |
| `text-danger` | `#cb272f` | Errors and destructive actions |
| `border-hairline` | 12% obsidian | Default 1px borders and dividers |
| `border-hairline-strong` | 28% obsidian | Input borders, emphasized dividers |

Hard rules:
- **Never put lime text on a light surface.** Lime is a fill, or text on `bg-forest` / `bg-spruce` only.
- One lime element per visible section. Don't stack lime chips next to a lime button.
- No gradients, glows, blurs or decorative shadows. Depth comes from surface steps (white, fog, linen, forest) and hairlines. `shadow-float` / `shadow-lift` are only for floating layers: popovers, drawers, dialogs and toasts.
- No pure black text. Body is Charcoal; headings Obsidian or Forest.
- On a forest section: body `text-paper/80`, headings `text-paper` or `text-lime`, borders `border-white/15`, secondary buttons `border-white/40 text-paper`.

## Type

- Body/UI: Inter (`font-sans`), 15px base, weights 400/500/600/700. Labels and buttons use 600.
- Display: the `display` utility (Archivo 900, expanded, uppercase, -0.03em, line-height 0.88). **Hero and big section openers only** (40px+). Never for app chrome, card titles or tables.
- Headings inside the app: Inter 600–700, tight tracking (`tracking-[-0.02em]` at 24px+). Example scale: page title 28–36px/700, section 20px/600, card title 16px/600.
- `eyebrow` utility: 12px, 600, uppercase, 0.06em, muted. Use sparingly.
- Numbers: `tabular`. `font-mono` only for IDs, URLs, code, timestamps and raw scores. Not for labels or headings.

## Shape and spacing

- Buttons, tags, chips, segmented controls, nav items, avatars: **pill** (`rounded-pill` / `rounded-full`).
- Cards and inputs: `rounded-card` (10px). Feature and hero cards, dark CTA blocks: `rounded-large` (28px).
- Never 0–4px corners on interactive elements.
- 4px grid. Card padding 16–24px. Element gaps 8–12px. Section gaps 48–80px on marketing pages.
- Max content width 1200px on marketing pages; app views can go full width with 24px gutters.

## Components

- **Button** (`components/ui/button.tsx`). Variants:
  - `cta`: lime pill, forest text.
  - `forest`: dark pill, lime text. Use on lime or linen bands.
  - `outline`: white pill with a forest border.
  - `raised`: fog pill.
  - `ghost`.
  - `link`: underlined forest text.

  Pair a `cta` with a `link` for the secondary action, never with two filled buttons. Sizes: sm (32px), md (36px), lg (48px).
- **Segmented tabs / nav**: a pill container (`bg-raised p-1 rounded-pill`). Each segment is a pill at `h-8 px-3 text-sm font-semibold`. Active: `bg-lime text-forest`. Inactive: `text-charcoal hover:bg-paper`. On a forest header: inactive `text-paper/75 hover:text-paper hover:bg-white/10`, active `bg-lime text-forest`.
- **Input / textarea / select**: `rounded-card border border-hairline-strong bg-paper px-4 py-3 text-[15px] text-strong`. Focus: `focus:border-forest focus:outline-none`, with no glow ring.
- **Card** (`components/ui/card.tsx`). Surfaces:
  - `raised`: white card with a hairline border.
  - `recessed`: fog panel.
  - `interactive`.
  - `forest`.

  `radius="large"` gives 28px.
- **Pill / badge** (`components/ui/pill.tsx`). Tones:
  - `neutral`: fog.
  - `lichen`: linen with forest text.
  - `solid`: forest with lime text.
  - `warning`: soft red.
  - `muted`: outline.
- **VerdictChip**: lime for Verified, butter for Promising, coral for Hype, fog with strikethrough for Killed, outlined for Pending. Labels are in title case.
- **Icon chip**: an icon in a 40px circle, `bg-raised text-forest`, or `bg-lime text-forest` for the active one.
- **Tables / lists**: no zebra striping. Hairline row dividers, row hover `bg-linen/50`, header row 12px 600 muted. Selected row: `bg-linen`.
- **Drawers / popovers / dialogs**: `bg-paper`, `rounded-large` (dialog) or `rounded-card` (popover), `shadow-float`, and a hairline border.
- **Dark CTA block**: `bg-forest rounded-large p-10`. Headline `text-lime`, body `text-paper/80`, button `forest`→ use `cta` (lime) on dark.

## Voice

Short, direct and confident. Buttons use three words or fewer. Simulated results are always labeled "Simulated"; only Sounding marks a market as real.

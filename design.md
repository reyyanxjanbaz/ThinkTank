# Design: Retro 8-bit Pixel UI/UX

## Goals
- Feel like a playful 80s/90s game UI with crisp pixels and chunky geometry.
- Keep content readable and modern while preserving pixel authenticity.
- Make navigation feel like a game map with clear quests and progress.

## Visual Direction
- Theme: "Neon Arcade Workshop" (bright pixels, dark-but-not-black surfaces, grid + scanline hints).
- Shapes: hard edges, 1-2px outlines, 8px corner chamfers (no rounded corners).
- Texture: subtle pixel noise and faint scanline overlay, used sparingly.

## Color System
- Base: Deep navy (#10162B) instead of pure black for contrast comfort.
- Primary: Electric cyan (#3CF2FF).
- Secondary: Hot coral (#FF5C7A).
- Accent: Pixel yellow (#FFD24A).
- Success: Mint green (#45F29D).
- Warning: Amber (#FFB347).
- Error: Pixel red (#FF3B3B).
- Neutrals: Slate grays (#2B3147, #3B425C, #6E7697).

## Typography
- Display: 8-bit pixel font for headings (e.g., "Press Start 2P").
- Body: A clean pixel-like sans (e.g., "VT323" or "IBM Plex Mono") for readability.
- Hierarchy: H1 32px, H2 24px, H3 18px, body 14-16px, all aligned to 4px grid.

## Layout Grid
- Base grid: 4px. Sections: 16px, 24px, 32px spacing steps.
- Max width: 1080px with generous whitespace on desktop.
- Use 12-column grid for content, but snap cards and dividers to 8px multiples.

## Key Pages and UX

### 1) Home (Landing)
- Hero: Pixel-art skyline or lab console. Left: tagline + CTA. Right: animated sprite/mascot.
- Primary CTA: "Start a Quest"; Secondary: "Watch the Demo".
- Feature row: 3-4 pixel cards with icon sprites.
- Social proof: Pixel badges and "achievement" tiles.

### 2) Product / How It Works
- Step-by-step "Level" sections (Level 1: Capture Ideas, Level 2: Organize, Level 3: Share).
- Each level has a pixel progress bar and trophy icon.

### 3) Pricing
- Pricing as "Game Packs" (Starter, Pro, Guild).
- Each plan is a cartridge-style card with a pixel sticker for "Best Value".

### 4) Blog / Resources
- List with pixel tabs (Tips, Updates, Guides).
- Posts render like a game manual with callout boxes.

### 5) About / Story
- Timeline is a side-scrolling level with checkpoints.
- Team tiles as "NPC cards" with stats (Role, Special Move).

### 6) Contact / Support
- Support options shown as "Power-ups".
- Form looks like a save slot with pixel checkboxes.

## Navigation
- Top bar: pixel logo at left, nav items as 8-bit tabs.
- Active state: blinking cursor block or animated underline.
- Mobile: hamburger icon becomes "Start" button; menu opens like a game pause screen.

## Components
- Buttons: 3D pixel bevel (2px lighter top, 2px darker bottom). States: idle, hover, pressed.
- Cards: 2px outline, 8px padding, inner shadow for "screen" feel.
- Badges: tiny pixel chips with borders.
- Inputs: inset pixel field with cursor block and blinking caret.
- Toggles: tiny D-pad switch.
- Progress: 8-bit segmented bar.
- Tooltip: pixel speech bubble.

## Iconography & Illustrations
- Use 16x16 or 24x24 pixel icons with 1-2px outline.
- Illustrations: sprite-style scenes with limited palette.
- Keep sprites consistent scale across the site.

## Motion & Interaction
- Page load: quick "scanline sweep" and 2-3 frame sprite bounce.
- Hover: 1px nudge and tiny glow.
- Button press: 2px down shift.
- Transitions: snap-fast (120-180ms) and easing like steps.
- Avoid overly smooth motion; keep it snappy.

## Sound (Optional)
- Tiny 8-bit click sounds for CTA and toggles.
- Allow mute toggle in the footer.

## Accessibility
- Maintain contrast ratio >= 4.5:1 for text.
- Provide "Low Motion" toggle.
- Allow a "High Readability" mode using a non-pixel body font.

## Content Tone
- Playful, quest-like language: "Power Up", "Unlock", "Save".
- Use short, punchy copy and 1-line feature descriptions.

## Responsive Strategy
- Desktop: full pixel art hero; stacked cards in 2-3 columns.
- Tablet: reduce art size, keep hero two-column.
- Mobile: single column, nav as pause screen, cards become wide chips.

## Top-Level Design Tokens (Draft)
- Radius: 0 (with 8px chamfers via sprites).
- Border: 2px solid, mostly #3B425C.
- Shadows: 2px offset, #0B0F1F at 40% opacity.
- Spacing: 4, 8, 12, 16, 24, 32, 48, 64.
- Icon sizes: 16, 24, 32.

## Next Steps
- Pick final font pair and create a mini style tile.
- Decide 3 hero illustration concepts.
- Mock the home and pricing pages first for visual alignment.

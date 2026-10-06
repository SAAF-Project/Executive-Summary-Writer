---
name: ESWriter
description: A calm corporate workspace for reviewing presentation templates.
colors:
  blue: "#164dcc"
  blue-hover: "#123eab"
  navy: "#293a65"
  cyan: "#009ee3"
  gradient-indigo: "#0800b9"
  ink: "#1b2946"
  muted: "#607087"
  ground: "#f7f9fc"
  surface: "#ffffff"
  line: "#e2e7ef"
  pale: "#edf3fe"
  green: "#176c51"
  green-pale: "#edf8f2"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "20px"
    fontWeight: 620
    lineHeight: 1.35
    letterSpacing: "-0.018em"
  title-small:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  field:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  badge: "4px"
  field: "5px"
  control: "6px"
  workflow: "8px"
  editor: "10px"
  surface: "12px"
spacing:
  compact: "8px"
  control: "10px"
  field: "12px"
  inline: "16px"
  card: "18px"
  section: "20px"
  grid: "24px"
  panel: "28px"
  shell: "40px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.blue-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#324766"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "#f0f5fd"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.blue}"
    typography: "{typography.label}"
    padding: "5px 0"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.field}"
    padding: "8px 9px"
  navigation-selected:
    backgroundColor: "{colors.pale}"
    textColor: "{colors.blue}"
    rounded: "7px"
    padding: "12px"
  badge-neutral:
    backgroundColor: "#eff2f7"
    textColor: "#59657a"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  badge-blue:
    backgroundColor: "#eaf1ff"
    textColor: "#2356b0"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  badge-green:
    backgroundColor: "{colors.green-pale}"
    textColor: "{colors.green}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  template-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.surface}"
  upload-panel:
    rounded: "{rounded.surface}"
    padding: "28px"
  editor-workspace:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.editor}"
---

# Design System: ESWriter

## Overview

**Creative North Star: "The Corporate Audit Workspace"**

White work areas on a cool gray ground make this a quiet, practical application. The supplied AFKL presentation supplies the navy, blue, and cyan character; the application translates it into compact controls, legible section headings, and restrained blue gradients. These are interface conventions, not a reproduction of the presentation's page layouts or logo.

The system supports close review. Borders distinguish work areas, navy anchors reference material, and blue identifies actions and the current selection. Most supporting information is compact. Uploaded presentation content has its own appearance and must remain visually distinct from application controls.

**Key Characteristics:**
- White surfaces and cool gray ground with a single blue action accent.
- Compact system UI typography and restrained heading weights.
- Flat bordered containers; a soft shadow reserved for the source preview.
- Small control corners, larger panel corners, and inline SVG icons.
- Responsive review areas that become a stacked workflow on narrow screens.

## Colors

The palette combines clear corporate blue with navy structure, cool neutrals, and a modest green success signal. Frontmatter values are normative; the sidecar records gradients and component state details.

### Primary
- **Corporate Blue** (`blue`): primary actions, selected navigation, active editor tabs, caret, checkbox, and progress states. **Deep Corporate Blue** (`blue-hover`) marks primary-button hover.
- **Reference Navy** (`navy`): source-preview tables and the corporate reference palette. The reference panel uses a darker navy gradient rather than a flat fill.
- **Deck Indigo** (`gradient-indigo`) and **Deck Cyan** (`cyan`): the brand tile, the current workflow underline, and illustrative reference accents. Cyan also marks the workspace dot.

### Secondary
- **Review Green** (`green`) over **Success Tint** (`green-pale`): saved status and completion indicators. Green communicates status rather than general action.

### Neutral
- **Audit Ink** (`ink`): headings, values, and main text.
- **Slate Copy** (`muted`): supporting copy and placeholders. Placeholder opacity stays at full strength.
- **Cool Ground** (`ground`): the application background.
- **White Work Area** (`surface`): navigation, toolbar, fields, cards, and editor.
- **Quiet Divider** (`line`): structural borders and separators.
- **Selection Tint** (`pale`): selected navigation.

### Named Rules
**The Action Blue Rule.** Blue identifies an action, selection, or progress state. Use navy for reference context and green for successful completion.

**The Gradient Accent Rule.** Preserve gradients in the small brand tile, current workflow underline, upload surface, and reference region. Main buttons and editable fields use solid fills.

## Typography

**Body and UI Font:** the native system UI stack in the frontmatter. No external font is loaded. The application has no separate expressive display typeface.

**Preview Font:** Arial with a sans-serif fallback. Source-object color, weight, alignment, and relative size come from presentation metadata; they are user content rather than application tokens.

**Character:** moderate weights and slight negative tracking make application headings clear without display ornament. Sentence case and short labels suit repeated review actions.

### Hierarchy
- **Headline:** page headings use the frontmatter headline role; the editor reduces this to (25px), while narrow page headings use (25px).
- **Title:** section headings use the title role. Reference and upload headings vary between (20–22px); the preview title uses (16px).
- **Small Title:** the base third-level heading role. Dense inspector headings reduce to (12px) on desktop and expand to (14px) on mobile.
- **Body:** the default application text role. Supporting panel copy commonly uses (12px) with generous line height; explanatory text is constrained to roughly (40–65ch) where the layout permits.
- **Label:** buttons use the label role; navigation uses (13px). Counts and slide numbers use tabular numerals.
- **Field:** desktop form values use the compact field role. At the mobile breakpoint, editable fields expand to (16px); field search stays at (13px).

### Named Rules
**The Source Type Rule.** Preview typography scales with its slide container in `cqw`. Application text uses the UI ramp; do not apply source-deck typography to application controls.

## Layout

The desktop shell has a sticky white sidebar (224px) and a white top bar (68px). Main content is centered with a maximum width of (1590px), horizontal gutters of (40px), and top padding of (36px). The recurring spacing steps are recorded in the frontmatter; component pairs generally use (20–24px) gaps.

The dashboard pairs a flexible upload area with a reference region, then shows a three-column template library. The review workspace uses a slide rail, a flexible preview, and an inspector (155px / flexible / 310px). Larger screens expand the rail and inspector. Its body is one clipped bordered surface, divided internally by flat lines.

Responsive behavior follows the actual stylesheet: at (1250px) gutters and the sidebar compress, and libraries become two columns; at (1050px) the sidebar becomes an icon rail (72px); at (800px) the dashboard stacks and the inspector sits beneath the preview while the slide rail stays beside both; at (600px) navigation becomes a sticky top row, libraries become one column, slides become a horizontal scrolling rail, and the editor stacks completely. Mobile gutters are (18px). At (1600px) the editor rail and inspector widen to (185px / 345px).

**The Review Order Rule.** Preserve slide selection, preview, and editable interpretation as distinct regions through responsive changes. Compact the layout before stacking; keep the source visible above the mobile inspector.

## Elevation & Depth

The application is predominantly flat. White surfaces, pale contextual fills, navy reference material, and thin borders create separation without card shadows. The source slide alone receives a soft preview shadow; small library and rail previews remove it. Focus is a visible outline rather than an elevation effect.

### Shadow Vocabulary
- **Source Preview:** `0 5px 18px #243a6014`. Applied to the full source slide canvas; absent from small preview canvases.

### Named Rules
**The Flat Work Area Rule.** Keep application panels and controls flat. Reserve the recorded shadow for the full source preview.

## Shapes

Controls have gently curved corners, with separate small field and badge radii. Panels use the larger surface radius; the editor is slightly tighter. The workflow is a clipped horizontal strip. Structural borders are (1px); the upload boundary is dashed. Selection markers and status dots are circular, while slide canvases remain rectangular and follow the source aspect ratio.

Use line icons as inline SVGs, usually (14–18px) for controls. Larger status and upload icons are reserved for their illustrated or empty-state role. No shipping raster assets or corporate logo are used; embedded slide images are runtime user data.

## Components

### Buttons
Compact, clear actions. Primary and secondary buttons share the recorded padding and control radius, an icon gap of (8px), and a minimum height of (40px). Primary buttons use blue and white; secondary buttons use white, a cool gray border, and dark slate text. Hover darkens primary blue or lightly tints secondary white. Background and text transitions last (160ms) with `ease-out`. Text buttons are blue, with an underline and darker text on hover; icon buttons use a pale hover fill. Disabled buttons use a blocked cursor and opacity of (0.48).

### Chips
Status information is compact and inline: (10px) type, weight (550), line height (1.5), and a small gap for optional icons. Neutral status uses gray, manual-review status uses blue, and saved status uses green. Chips describe state; they are not decorative labels above headings.

### Cards / Containers
Template cards use the surface radius, a white fill, a quiet border, and clipped contents. A tinted thumbnail area leads into copy padded (17px 18px 14px), followed by a separated footer padded (9px 18px). Hover subtly changes the thumbnail ground. Empty states use the same flat surface with an icon and short explanation. Editor panels use the editor radius and internal dividers.

### Inputs / Fields
White editable fields use a cool gray stroke, the field radius, and recorded compact padding. Hover strengthens the border. Native control values use ink; placeholders use muted copy at full opacity. The global keyboard focus treatment is a (3px) blue outline with (3px) offset. Search containers instead use a (2px) outline on focus within. Textareas resize vertically. On mobile, field type and padding increase; checkboxes also grow from (13px) to (16px).

### Navigation
Sidebar items are left-aligned icon and text rows with a small radius and generous horizontal padding. Selection uses pale blue, blue text, and weight (620); hover uses a cool near-white fill. Desktop includes a count and workspace context. Tablet reduces navigation to icons; mobile moves it into the top row. Accessible labels remain present when text is hidden.

### Workflow Strip
Four equal regions show numbered, completed, or locked markers. Current progress uses a pale blue fill, blue text, and a two-pixel indigo-to-cyan underline. Completed markers use green. Mobile keeps the regions together while moving markers above short labels. The locked future step includes explicit status copy.

### Upload Surface
A dashed curved boundary surrounds a pale white-to-blue gradient and a CSS/SVG paper illustration. It uses centered copy and a solid primary action. Dragging replaces the gradient with a stronger pale-blue fill and blue border. Supporting drop instructions use muted copy, not a low-contrast decorative treatment.

### Source Preview and Object Inspector
The preview is an aspect-ratio canvas with absolutely positioned source objects. Text uses container-relative units, tables use fixed cell layouts, and embedded images use `object-fit: contain`. The preview is explicitly approximate. Source appearance is runtime data and is not added to the application palette.

Inspector fields are grouped by template, slide, and content object. Source objects use compact disclosure rows with their label and source kind; selected rows receive a stronger blue border and a check icon. Expanded rows expose editable definitions and a separate pale source-text region. Stable slide and object identifiers provide the binding between preview metadata and the reviewed definition.

## Do's and Don'ts

### Do:
- **Do** use the frontmatter palette and type ramp for application controls.
- **Do** keep action blue, completion green, and reference navy assigned to their recorded roles.
- **Do** preserve the visible focus treatment and full-opacity muted placeholders.
- **Do** use flat bordered panels and reserve the soft shadow for the full source slide.
- **Do** distinguish approximate uploaded source content, reviewed definitions, and unavailable future actions in their labels and states.
- **Do** keep icons as inline SVGs and treat uploaded images as runtime content.

### Don't:
- **Don't** add decorative eyebrow labels above page headings or saved-state panels.
- **Don't** add an external typography dependency or copy a corporate logo into the application shell.
- **Don't** promote colors, fonts, images, or geometry from an uploaded deck into the application design system.
- **Don't** use success styling to imply that a future decoder or generation agent is connected.
- **Don't** replace the flat work-area hierarchy with ornamental shadows or broad button gradients.

---
version: 1
slug: "src-noteui-componentcatalog-tsx"
primary_target: "src/noteui/ComponentCatalog.tsx"
related_targets: ["src/noteui/NoteUIBlock.tsx", "src/noteui/primitives.tsx", "src/noteui/Drawing.tsx", "src/styles/noteui-system.css", "src/styles/noteui.css"]
---

# NoteUI component system extension

Mode: Operate / Read. Extend the incumbent purple LearnAgent workspace and existing template catalog; the warm `?design=workspace` mock remains separately scoped.

THESIS: A readable Markdown article with occasional useful diagrams, experiments and compositions. Preserve all 28 teaching components and APIs; add reusable layout primitives and bounded AI-authored SVG drawings.

OWN-WORLD: Reuse incumbent system fonts, purple actions and light/dark variables. Semantic aliases map to these variables. Neutral article surfaces by default; reserve bordered panels for interactive experiments and independent tasks. Inner 8px, group 16px and section 24px spacing is container-owned. No new identity or display face.

STORY: Search the existing component catalog, read registry-derived parameters/defaults/limits, preview a real control, switch local light/dark and container width, then insert its editable Markdown. Developer Gallery is the same catalog at `?gallery=noteui`, with controlled foundations and a composed learning example.

FIRST VIEWPORT: A compact heading and preview controls, searchable component navigation, and one working example beside it. Mobile stacks the same navigation above the preview, without overflowing the page. The article example keeps explanatory prose free of card chrome.

FORM: Desktop keeps the catalog navigation beside the preview; mobile stacks the searchable list and reading content with bounded scrolling. Grid/Row respond to their content container. Popovers escape scrolling ancestors and support Escape/focus return. SVG uses finite coordinates and a bounded set of shapes/path commands; no model scripts, URLs, raw SVG or arbitrary CSS.

FINISH: Existing backend, Markdown fallback and save flows remain. Check legacy samples, streaming boundaries, source preservation, input states, keyboard interaction, light/dark and 360/768/1100px containers. Preserve the warm-preview DESIGN.md and sidecar. Fresh finish review and documentation apply only to this incumbent extension and accepted earlier AI rail changes.

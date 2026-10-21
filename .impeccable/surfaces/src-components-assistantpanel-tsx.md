---
version: 1
slug: "src-components-assistantpanel-tsx"
primary_target: "src/components/AssistantPanel.tsx"
related_targets: ["src/App.tsx", "src/components/InputBar.tsx", "src/styles/assistant.css"]
---

# Existing workspace AI rail

Mode: Operate with a Read center. This is a scoped extension of the default application, distinct from the warm `?design=workspace` exploration.

## Direction contract

THESIS: Keep the user's screenshot as the visual authority: existing file tree, document tabs, note metadata and reading surface. Move the global floating composer into a persistent right AI rail.

OWN-WORLD: Preserve incumbent light/dark tokens, purple actions, Material Symbols and system typography. The user pinned the incumbent appearance; this is not an identity replacement.

STORY: Open a real note, read without a floating input obstruction, discuss it beside the page, switch to scoped note tutoring, attach images, answer agent questions and stop a running task. Existing backend session files remain authoritative.

FIRST VIEWPORT: Existing navigation and reading chrome remain, with a 400px resizable AI rail. Global history and note tutoring share one rail, with the existing composer anchored below the message list. Narrow screens open the AI as a drawer and allow the file tree to close independently.

FORM: Desktop updates reading width once and reveals the rail using a restrained 220ms transform; mobile uses a 240ms transform drawer. A single 180ms message entrance and explicit task state support continuity. Never animate each streamed token or continuously reflow the note. Preserve drafts on close; honor reduced motion.

FINISH: Bounded desktop/mobile inspection, production build and relevant backend regression tests. Independent review checks only this approved extension, not a redesign of the incumbent or a reroll of the previous preview. Update extension documentation while preserving preview-scoped DESIGN.md and its sidecar.

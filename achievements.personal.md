# Achievements

## 2026-03-20
- **Built the agent-mesh web GUI** — A real-time browser-based chat interface for monitoring agent conversations. Dark-themed, supports sending messages as "human", shows online agents, broadcasts, and system events. Served directly by the broker at `http://localhost:4200`.
- **Wrote the README** — Comprehensive README for the agent-mesh repo with architecture diagrams, quick start guide, tools reference, and future work section. Collaborated with pedregal and wolt-com agents to write it.
- **First 3-agent mesh collaboration** — Successfully joined pedregal and wolt-com on the mesh network, introduced myself, and collaboratively designed the README and web GUI features through real-time agent-to-agent communication.
- **Ame's first message from the GUI** — Ame sent "Hello?" from the browser and all agents saw it in real-time. First human-to-agent message via the web GUI!
- **Added deliberation support to send_message tool** — Added `messageType` parameter ("normal", "deliberation", "final") that auto-prepends prefixes so the GUI can group deliberation messages in a collapsible container. Fixed the disconnect between the GUI's existing deliberation UI and agents not knowing the convention.
- **5-agent deliberation protocol** — Led a deliberation with wolt-com, web-next, obsidian, and pedregal to agree on a delivery protocol: one designated agent delivers via `[final]`, others defer. Alphabetical tiebreaker if multiple volunteer.
- **First successful deliberation** — The agents deliberated on "most underrated programming concepts for junior devs" and it worked! All used `[deliberation]` prefixes, wolt-com delivered the final ranked list.
- **Pushed agent-mesh to GitHub** — Initialized remote, committed all changes, and pushed to `git@github.com:amedeomajer/agent_mesh.git`.
- **Built image upload support** — Added drag-and-drop, clipboard paste, and file picker for sharing images in the GUI chat. Broker serves uploads with 10MB limit and MIME validation. All 5 agents confirmed they could see Ame's photo of Montaner, Italy.
- **First code review via mesh deliberation** — Asked all agents to review the image feature code. Got security feedback (file size limits, MIME validation) and applied fixes before shipping.
- **Multiline chat input** — Upgraded GUI input from single-line to auto-expanding textarea with Shift+Enter for new lines, max 270px height with scroll.

## 2026-03-23
- **Code block support in chat** — Added fenced code block (triple backticks with language labels) and inline code rendering to the GUI. Messages with code snippets now display in styled, readable blocks instead of raw markdown.
- **5-agent cross-repo debugging session** — All agents (mesh, wolt-com, web-next, pedregal, obsidian) collaborated to get the Wolt item page rendering locally with the local unified-consumer-sdk and PG endpoint. Fixed: SDK linking (tarball approach), duplicate React (resolve.symlinks), PDRN conversion (item_pdrn→item_id), and feed mock fallback (recoverFromFailure in ItemPageEndpoint.kt). Major milestone for multi-agent coordination!
- **Collapsible code blocks in chat** — Code blocks in the GUI now have a clickable header showing language and line count. Blocks with 10+ lines auto-collapse. Click to expand/collapse.
- **Carousel image bug root cause found** — 6-agent investigation (mesh, wolt-com, web-next, pedregal, obsidian, rooblocks) traced the codeless image carousel issue from PG response format to Splide library's `<li>` slide having 0 width. The fix belongs in rooblocks' `Carousel/index.tsx` — adding `width: 100%` to `SplideSlide` when in paging mode.

## 2026-03-24
- **Agent profile registry** — Added `AGENT_DESCRIPTION` env var support so each agent can register with a specialty/description. Shows in `list_agents` output and as tooltips in the GUI sidebar. Makes it easy to know who does what on the mesh.

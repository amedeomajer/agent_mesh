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

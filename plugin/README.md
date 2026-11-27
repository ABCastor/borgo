# Borgo plugin for ChatGPT and Codex

The package OpenAI's plugin directory takes: `plugin.json` (Agent Plugins manifest with the listing and review cases under `extensions.com.openai`), `mcp.json` (the hosted server at https://borgo.abcastor.com/mcp, no sign-in) and the icons in `assets/`.

The review's `demo_recording_url` is https://borgo.abcastor.com/review/walkthrough.mp4, served from `public/root/review/walkthrough.mp4`: the eight test cases in order, recorded against the live server in a test host that renders Borgo's MCP Apps chart and says on screen that it is not ChatGPT. Re-record it when the test cases change.

Build the ZIP from this folder: `cd plugin && zip -r ../borgo-plugin.zip plugin.json mcp.json assets`.

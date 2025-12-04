https://github.com/archestra-ai/archestra/issues/1303

Issue reference: [#1303 - Browse web via MCP, native in Archestra](https://github.com/archestra-ai/archestra/issues/1303)

## Executive Summary

Dear community, let's build something amazing.

**We're thinking of giving Archestra Chat UI the ability to browse the web inside Archestra's Chat UI. Similar to cursor's browser:**
![cursor-browser](./cursor-browser.png)

This task is to add browser automation capabilities to Archestra.
The solution extends the existing MCP orchestrator to provide browser state management and UI rendering.

## Design Questions


Good design questions to think about:

How to make it work via MCP? Use playwright MCP, build a custom MCP, or use embedded Archestra MCP?

- playwright MCP is the best option, because it is the most popular and well-supported browser automation library.


How to show what the agent is doing in the UI nicely?

- We should create BrowserPreview component to show what the agent is doing in the UI.

How will it comply with our security model?

- We should use the existing security model.

How to represent it in logs nicely?

- We should use the existing logging model.

How to handle sessions and cookies? What if the user wants to authenticate in the UI and then ask the agent to continue?

- We should use the existing session management model.

Hard requirements:

No closed-source dependencies.
No cloud services dependencies.
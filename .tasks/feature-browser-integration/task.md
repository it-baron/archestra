https://github.com/archestra-ai/archestra/issues/1303

Issue reference: [#1303 - Browse web via MCP, native in Archestra](https://github.com/archestra-ai/archestra/issues/1303)

## Executive Summary

This task is to add browser automation capabilities to Archestra.
The solution extends the existing MCP orchestrator to provide browser state management and UI rendering.

## Design Questions


Good design questions to think about:

How to make it work via MCP? Use playwright MCP, build a custom MCP, or use embedded Archestra MCP?
How to show what the agent is doing in the UI nicely?
How will it comply with our security model?
How to represent it in logs nicely?
How to handle sessions and cookies? What if the user wants to authenticate in the UI and then ask the agent to continue?
Hard requirements:

No closed-source dependencies.
No cloud services dependencies.
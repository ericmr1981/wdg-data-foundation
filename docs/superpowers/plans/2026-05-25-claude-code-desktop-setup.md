# Claude Code Desktop MCP Setup

## Add WDG Bank Agent MCP Server

Edit `ui/.mcp.json` (or global `~/.claude/settings.json` mcpServers section) to add:

```json
{
  "mcpServers": {
    "wdg-bank-agent": {
      "url": "http://localhost:4100/api/mcp"
    }
  }
}
```

Restart Claude Code Desktop. The bank-agent tools will appear in the tool list.

## Prerequisite

The Next.js dev server must be running on port 4100:
```bash
cd ui && npm run dev
```
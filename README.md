# Open Brain MCP

A remote MCP server on Cloudflare Workers that gives any MCP-compatible AI client access to a unified personal memory system backed by Supabase + pgvector.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Deploy to Cloudflare

```bash
wrangler login
wrangler deploy
```

### 3. Set secrets

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put OPENAI_API_KEY
```

### 4. Connect from any machine

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "open-brain": {
      "url": "https://open-brain-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

**Claude Code** (`.mcp.json` in project root):

```json
{
  "mcpServers": {
    "open-brain": {
      "url": "https://open-brain-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill in your keys, then:

```bash
npm run dev
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `save_memory` | Save a memory with optional type and tags |
| `search_memory` | Semantic search across all memories |
| `list_memories` | List recent memories, optionally filtered by type |
| `delete_memory` | Delete a memory by ID |

### Memory types

`thought` · `decision` · `person` · `insight` · `meeting` · `work` · `personal` · `general`

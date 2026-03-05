import { createClient } from "@supabase/supabase-js";

const MEMORY_TYPES = [
  "thought", "decision", "person", "insight",
  "meeting", "work", "personal", "general",
];

const TOOLS = [
  {
    name: "save_memory",
    description: "Save a memory to your personal brain",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The content to remember" },
        type: { type: "string", enum: MEMORY_TYPES, description: "Category of memory" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
      },
      required: ["content"],
    },
  },
  {
    name: "search_memory",
    description: "Search your memories by semantic similarity",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        limit: { type: "number", description: "Number of results to return (default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "List recent memories",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of memories to list (default 10)" },
        type: { type: "string", enum: MEMORY_TYPES, description: "Filter by memory type" },
      },
    },
  },
  {
    name: "delete_memory",
    description: "Delete a memory by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The ID of the memory to delete" },
      },
      required: ["id"],
    },
  },
];

async function getEmbedding(text, apiKey) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Embedding request failed");
  return data.data[0].embedding;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parseVector(str) {
  return str.slice(1, -1).split(",").map(Number);
}

async function handleToolCall(name, args, env) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  switch (name) {
    case "save_memory": {
      const { content, type = "general", tags = [] } = args;
      const embedding = await getEmbedding(content, env.OPENAI_API_KEY);
      const { data, error } = await supabase
        .from("memories")
        .insert({ content, type, tags, embedding: `[${embedding.join(",")}]` })
        .select("id, created_at")
        .single();
      if (error) throw new Error(`Failed to save: ${error.message}`);
      return {
        content: [{ type: "text", text: `Memory saved.\nID: ${data.id}\nType: ${type}\nSaved at: ${data.created_at}` }],
      };
    }

    case "search_memory": {
      const { query, limit = 5 } = args;
      const queryEmbedding = await getEmbedding(query, env.OPENAI_API_KEY);

      // Fetch memories with embeddings and compute similarity in JS
      // to avoid depending on the RPC function's internal threshold
      const { data: memories, error } = await supabase
        .from("memories")
        .select("id, content, type, tags, embedding, created_at");

      if (error) throw new Error(`Search failed: ${error.message}`);
      if (!memories || memories.length === 0) {
        return { content: [{ type: "text", text: "No memories found." }] };
      }

      const scored = memories
        .map((m) => ({
          ...m,
          similarity: cosineSimilarity(queryEmbedding, parseVector(m.embedding)),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      const results = scored
        .map((m, i) => {
          const pct = (m.similarity * 100).toFixed(1);
          const date = new Date(m.created_at).toLocaleDateString();
          return `${i + 1}. [${pct}% match] (${m.type || "general"}) ${date}\n   ${m.content}`;
        })
        .join("\n\n");

      return { content: [{ type: "text", text: `Found ${scored.length} memories:\n\n${results}` }] };
    }

    case "list_memories": {
      const { limit = 10, type } = args;
      let query = supabase
        .from("memories")
        .select("id, content, type, tags, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (type) query = query.eq("type", type);
      const { data, error } = await query;
      if (error) throw new Error(`List failed: ${error.message}`);
      if (!data || data.length === 0) {
        return { content: [{ type: "text", text: "No memories found." }] };
      }
      const results = data
        .map((m) => {
          const date = new Date(m.created_at).toLocaleDateString();
          const preview = m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content;
          const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
          return `- ${m.id} | ${m.type || "general"} | ${date}${tags}\n  ${preview}`;
        })
        .join("\n\n");
      return { content: [{ type: "text", text: `${data.length} memories:\n\n${results}` }] };
    }

    case "delete_memory": {
      const { id } = args;
      const { error } = await supabase.from("memories").delete().eq("id", id);
      if (error) throw new Error(`Delete failed: ${error.message}`);
      return { content: [{ type: "text", text: `Memory ${id} deleted.` }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function jsonRpc(id, result) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: corsHeaders() });
}

function jsonRpcError(id, code, message) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
  };
}

async function handleMcp(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method === "DELETE") {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const body = await request.json();

  if (!("id" in body)) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }

  switch (body.method) {
    case "initialize":
      return jsonRpc(body.id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "open-brain", version: "1.0.0" },
      });

    case "ping":
      return jsonRpc(body.id, {});

    case "tools/list":
      return jsonRpc(body.id, { tools: TOOLS });

    case "tools/call": {
      try {
        const result = await handleToolCall(body.params.name, body.params.arguments || {}, env);
        return jsonRpc(body.id, result);
      } catch (err) {
        return jsonRpc(body.id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }

    if (url.pathname === "/") {
      return new Response("Open Brain MCP Server is running.", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

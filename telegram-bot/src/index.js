async function sendTelegram(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function mcpCall(env, toolName, args) {
  const res = await env.MCP_SERVICE.fetch("https://worker/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(res.statusText);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result?.content?.[0]?.text || "";
}

async function handleSave(text, env) {
  try {
    await mcpCall(env, "save_memory", { content: text });
    return "\u2705 Saved";
  } catch (err) {
    return `Failed to save: ${err.message}`;
  }
}

function formatSearchResults(raw) {
  // Parse the raw text output from search_memory
  // Format: "Found N memories:\n\n1. [XX.X% match] (type) date\n   content"
  const lines = raw.split("\n\n");
  if (lines.length < 2) return raw;

  const results = lines.slice(1).map((block) => {
    const matchPct = block.match(/\[(\d+\.?\d*)% match\]/);
    const typeMatch = block.match(/\((\w+)\)/);
    const dateMatch = block.match(/\)\s+(.+)\n/);
    const contentMatch = block.match(/\n\s+(.+)/);

    const pct = matchPct ? parseFloat(matchPct[1]) : 0;
    const emoji = pct > 60 ? "\uD83D\uDFE2" : pct > 30 ? "\uD83D\uDFE1" : "\uD83D\uDD34";
    const type = typeMatch ? typeMatch[1] : "general";
    const date = dateMatch ? dateMatch[1] : "";
    let content = contentMatch ? contentMatch[1] : "";
    if (content.length > 150) content = content.slice(0, 150) + "...";

    return `${emoji} ${pct.toFixed(0)}% — *${type}* | ${date}\n${content}`;
  });

  return results.join("\n\n");
}

async function handleSearch(query, env) {
  try {
    const raw = await mcpCall(env, "search_memory", { query, limit: 5 });
    if (raw.includes("No memories found")) return raw;
    return formatSearchResults(raw);
  } catch (err) {
    return `Search failed: ${err.message}`;
  }
}

async function handleList(env) {
  try {
    const raw = await mcpCall(env, "list_memories", { limit: 5 });
    if (raw.includes("No memories found")) return raw;

    // Parse: "- uuid | type | date [tags]\n  preview"
    const entries = raw.split("\n\n").slice(0);
    // First line is "N memories:" header if present
    const lines = entries.filter((l) => l.startsWith("- "));

    const results = lines.map((block) => {
      const parts = block.match(/^- .+? \| (\w+) \| (.+?)(\s+\[.+?\])?\n\s+(.+)/);
      if (!parts) return block;
      const type = parts[1];
      const date = parts[2];
      let preview = parts[4];
      if (preview.length > 150) preview = preview.slice(0, 150) + "...";
      return `*${type}* | ${date}\n${preview}`;
    });

    return results.join("\n\n") || raw;
  } catch (err) {
    return `List failed: ${err.message}`;
  }
}

const HELP_TEXT =
  "*Open Brain*\n\n" +
  "/save <text> — Save a memory\n" +
  "/search <query> — Search your memories\n" +
  "/list — Show 5 most recent memories\n" +
  "/help — Show this message\n\n" +
  "Or just send any text to save it as a memory.";

const ALLOWED_CHAT_ID = 523702419;

async function handleWebhook(request, env) {
  const update = await request.json();
  const message = update.message;
  if (!message?.text) return new Response("ok");

  const chatId = message.chat.id;
  if (chatId !== ALLOWED_CHAT_ID) return new Response("ok");

  const text = message.text.trim();

  if (text.startsWith("/save ")) {
    const content = text.slice(6).trim();
    if (!content) {
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, "Usage: /save <text to remember>");
      return new Response("ok");
    }
    const reply = await handleSave(content, env);
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply);
  } else if (text.startsWith("/search ")) {
    const query = text.slice(8).trim();
    if (!query) {
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, "Usage: /search <query>");
      return new Response("ok");
    }
    const reply = await handleSearch(query, env);
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply);
  } else if (text === "/list") {
    const reply = await handleList(env);
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply);
  } else if (text === "/start" || text === "/help") {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, HELP_TEXT);
  } else if (!text.startsWith("/")) {
    // Auto-save plain text as a memory
    const reply = await handleSave(text, env);
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply);
  }

  return new Response("ok");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    if (url.pathname === "/") {
      return new Response("Open Brain Telegram Bot is running.");
    }

    return new Response("Not found", { status: 404 });
  },
};

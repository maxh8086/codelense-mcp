import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildTools } from './tools.js';

export const TOOLS = buildTools();
export const toolByName = (n) => TOOLS.find((t) => t.name === n);

// Run one tool and shape failures so every transport reports them the same way.
export async function runTool(ctx, name, args) {
  const tool = toolByName(name);
  if (!tool) { const e = new Error(`unknown tool ${name}`); e.status = 404; throw e; }
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) { const e = new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')); e.status = 400; throw e; }
  return tool.handler(ctx, parsed.data);
}

export function createMcpServer(ctx) {
  const server = new McpServer({ name: 'codelense-mcp', version: '0.1.0' });
  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.schema.shape }, async (args) => {
      try {
        const out = await runTool(ctx, t.name, args);
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: e.message, status: e.status ?? 500, ...(e.extra ?? {}) }) }] };
      }
    });
  }
  return server;
}

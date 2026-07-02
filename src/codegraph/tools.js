import { buildGraph } from "./build.js";
import { search, callers, callees, impact, explore, invalidate } from "./query.js";

// Rebuild the graph and drop the query cache so the next lookup sees fresh data.
// Used by the CLI's auto-build on start and the /index command.
export async function buildAndRefresh(opts = {}) {
  const stats = await buildGraph(opts);
  invalidate(null);
  return stats;
}

function tool(name, description, properties, required, run) {
  return {
    mutating: false,
    run,
    schema: {
      type: "function",
      function: { name, description, parameters: { type: "object", properties, required } },
    },
  };
}

// The built-in code-graph tools the model can call during a session. They read
// the prebuilt graph (see build.js) — fast, structural navigation instead of grep.
export const CODEGRAPH_TOOLS = {
  code_search: tool(
    "code_search",
    "Find symbols (functions, classes, methods, types) by name across the codebase using the code graph. Returns name, kind, file and line. Prefer this over grep for locating definitions.",
    {
      query: { type: "string", description: "Symbol name or substring to search for" },
      limit: { type: "integer", description: "Max results (default 25)" },
    },
    ["query"],
    (args) => search(args.query, args.limit || 25)
  ),

  code_callers: tool(
    "code_callers",
    "List the functions/methods that call a given symbol (who depends on it). Uses the code graph's call edges.",
    { name: { type: "string", description: "Exact symbol name to find callers of" } },
    ["name"],
    (args) => callers(args.name)
  ),

  code_callees: tool(
    "code_callees",
    "List the functions/methods that a given symbol calls (what it depends on).",
    { name: { type: "string", description: "Exact symbol name to find callees of" } },
    ["name"],
    (args) => callees(args.name)
  ),

  code_impact: tool(
    "code_impact",
    "Show the blast radius of changing a symbol: all transitive callers that could be affected, with hop depth. Use before editing a widely-used function.",
    {
      name: { type: "string", description: "Exact symbol name" },
      depth: { type: "integer", description: "Max hops to traverse (default 5)" },
    },
    ["name"],
    (args) => impact(args.name, args.depth || 5)
  ),

  code_explore: tool(
    "code_explore",
    "Explore a topic: returns the matching definitions WITH their source code plus their immediate callers and callees. Use to understand how something works in one call.",
    {
      query: { type: "string", description: "Symbol name or topic to explore" },
      limit: { type: "integer", description: "Max definitions to return (default 6)" },
    },
    ["query"],
    (args) => explore(args.query, { root: process.cwd(), limit: args.limit || 6 })
  ),
};

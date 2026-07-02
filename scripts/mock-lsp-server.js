// Minimal mock LSP server for testing src/lsp/client.js without a real toolchain.
// Speaks the Content-Length JSON-RPC framing: answers initialize, publishes a
// diagnostic on didOpen, and returns canned hover/definition/references.
let buf = Buffer.alloc(0);

function send(msg) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const he = buf.indexOf("\r\n\r\n");
    if (he < 0) return;
    const m = /Content-Length:\s*(\d+)/i.exec(buf.slice(0, he).toString());
    if (!m) { buf = buf.slice(he + 4); continue; }
    const len = parseInt(m[1], 10);
    const start = he + 4;
    if (buf.length < start + len) return;
    const msg = JSON.parse(buf.slice(start, start + len).toString("utf8"));
    buf = buf.slice(start + len);
    handle(msg);
  }
});

function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return send({ id: msg.id, result: { capabilities: { hoverProvider: true, definitionProvider: true, referencesProvider: true } } });
    case "initialized":
      return;
    case "textDocument/didOpen": {
      const uri = msg.params.textDocument.uri;
      // Pretend line 2 has an error.
      return send({
        method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [{ range: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } }, severity: 1, message: "mock: undefined name 'bar'", source: "mock" }] },
      });
    }
    case "textDocument/didChange": {
      const uri = msg.params.textDocument.uri;
      return send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
    }
    case "textDocument/hover":
      return send({ id: msg.id, result: { contents: { kind: "plaintext", value: "function foo(a: number): number" } } });
    case "textDocument/definition":
      return send({ id: msg.id, result: { uri: msg.params.textDocument.uri, range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } } } });
    case "textDocument/references":
      return send({ id: msg.id, result: [
        { uri: msg.params.textDocument.uri, range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } } },
        { uri: msg.params.textDocument.uri, range: { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } } },
      ] });
    case "shutdown":
      return send({ id: msg.id, result: null });
    case "exit":
      return process.exit(0);
    default:
      if (msg.id != null) send({ id: msg.id, result: null });
  }
}

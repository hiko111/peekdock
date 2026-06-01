import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function contentType(filePath) {
  return MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json; charset=utf-8"
  });
  res.end(payload);
}

function serveFile(res, base, urlPath) {
  const withoutQuery = decodeURIComponent(urlPath.split("?")[0]);
  const filePath = normalize(join(base, withoutQuery === "/" ? "/index.html" : withoutQuery));
  if (!filePath.startsWith(base)) return false;
  try {
    if (!statSync(filePath).isFile()) return false;
    res.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": contentType(filePath)
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 1024 * 1024) reject(new Error("Too large")); });
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function execDreamina(args) {
  return new Promise((resolve) => {
    const proc = spawn("dreamina", args, { timeout: 15000 });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => stdout += d);
    proc.stderr.on("data", d => stderr += d);
    proc.on("close", code => resolve({ code, stdout, stderr }));
    proc.on("error", e => resolve({ code: -1, stdout: "", stderr: String(e) }));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    });
    res.end();
    return;
  }

  // API: Jim generate
  if (url.pathname === "/api/jim-generate" && req.method === "POST") {
    try {
      const { prompt, ratio, style } = await readBody(req);
      const ratioMap = { "1:1": "1:1", "16:9": "16:9", "9:16": "9:16", "3:4": "3:4" };
      const ratioArg = ratioMap[ratio] || "1:1";
      const args = ["text2image", `--prompt=${prompt}`, `--ratio=${ratioArg}`];
      const result = await execDreamina(args);
      let output;
      try { output = JSON.parse(result.stdout); } catch { output = {}; }

      if (output.submit_id) {
        sendJson(res, 200, { submit_id: output.submit_id, gen_status: output.gen_status });
      } else {
        sendJson(res, 200, { error: "Generation failed", detail: result.stderr || result.stdout });
      }
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // API: Jim query result
  if (url.pathname === "/api/jim-query" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return sendJson(res, 400, { error: "Missing id" });
    try {
      const result = await execDreamina(["query_result", `--submit_id=${id}`]);
      let output;
      try { output = JSON.parse(result.stdout); } catch { output = {}; }
      sendJson(res, 200, output);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // API: Jim credit
  if (url.pathname === "/api/jim-credit" && req.method === "GET") {
    try {
      const result = await execDreamina(["user_credit"]);
      let output;
      try { output = JSON.parse(result.stdout); } catch { output = {}; }
      sendJson(res, 200, output);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (serveFile(res, __dirname, url.pathname)) return;

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(port, host, () => {
  console.log(`PeekDock Unified UI → http://${host}:${port}/`);
  console.log(`API endpoints:`);
  console.log(`  POST /api/jim-generate  {prompt,ratio,style}`);
  console.log(`  GET  /api/jim-query?id=<submit_id>`);
  console.log(`  GET  /api/jim-credit`);
});

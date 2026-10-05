const http = require("http");
const fs = require("fs");
const path = require("path");
const { processVoiceAgent } = require("./voice-agent");

const root = __dirname;
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

http
  .createServer(async (request, response) => {
    if (request.method === "POST" && request.url.split("?")[0] === "/api/voice-agent") {
      try {
        const raw = await readBody(request);
        const payload = JSON.parse(raw || "{}");
        const result = await processVoiceAgent(payload);
        sendJson(response, 200, result);
      } catch (error) {
        console.error("voice-agent error", error);
        sendJson(response, 500, { status: "error", message: "Ошибка ассистента" });
      }
      return;
    }

    const requestedPath = decodeURIComponent(request.url.split("?")[0]);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
    const filePath = path.resolve(root, relativePath);

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        fs.readFile(path.join(root, "index.html"), (fallbackError, fallback) => {
          if (fallbackError) {
            response.writeHead(404);
            response.end("Not found");
            return;
          }
          response.writeHead(200, { "Content-Type": types[".html"] });
          response.end(fallback);
        });
        return;
      }

      response.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      response.end(data);
    });
  })
  .listen(port, () => {
    console.log(`FOCUS planner: http://localhost:${port}`);
    if (process.env.OPENAI_API_KEY) {
      console.log("Voice agent: OpenAI enabled");
    } else {
      console.log("Voice agent: local parser (set OPENAI_API_KEY for LLM)");
    }
  });

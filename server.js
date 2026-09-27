"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 8000);
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/config.js": ["config.js", "text/javascript; charset=utf-8"],
};

http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const entry = files[pathname];
  if (request.method !== "GET" || !entry) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  fs.readFile(path.join(__dirname, entry[0]), (error, content) => {
    if (error) {
      response.writeHead(500);
      response.end("Could not read file");
      return;
    }
    response.writeHead(200, { "Content-Type": entry[1], "Cache-Control": "no-store" });
    response.end(content);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`商品掌櫃已啟動：http://localhost:${port}`);
});

const fs = require("fs");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { readJson, nowIso };

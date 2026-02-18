// Simple logger with console + text-file logging (daily files per service).
// Now with ANSI colour support for console output.

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ANSI colours for console output
 */
const COLORS = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

const LEVEL_COLOUR = {
  debug: COLORS.gray,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
};

function makeLogger({
  serviceName,
  logPath,
  level = "info",
  toConsole = true,
  toTextFile = true,
} = {}) {
  if (!serviceName) throw new Error("core-logger: serviceName is required");
  if (!logPath) throw new Error("core-logger: logPath is required");

  ensureDir(logPath);

  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = levels[level] ?? levels.info;

  function write(line, colouredLine) {
    if (toConsole) console.log(colouredLine || line);

    if (toTextFile) {
      const file = path.join(logPath, `${serviceName}-${today()}.log`);
      fs.appendFileSync(file, line + "\n"); // keep files plain (no colour codes)
    }
  }

  function log(lvl, msg, meta) {
    const score = levels[lvl] ?? levels.info;
    if (score < min) return;

    const stamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";

    const plain = `[${stamp}] [${serviceName}] [${lvl.toUpperCase()}] ${msg}${metaStr}`;

    const colour = LEVEL_COLOUR[lvl] || "";
    const coloured =
      colour + `[${stamp}] [${serviceName}] [${lvl.toUpperCase()}] ${msg}` +
      COLORS.reset +
      metaStr;

    write(plain, coloured);
  }

  return {
    debug: (m, meta) => log("debug", m, meta),
    info: (m, meta) => log("info", m, meta),
    warn: (m, meta) => log("warn", m, meta),
    error: (m, meta) => log("error", m, meta),
  };
}

module.exports = { makeLogger };

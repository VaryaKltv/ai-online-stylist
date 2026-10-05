const MAX_LINES = 500;
const buffer = [];

function clean(value) {
  return String(value)
    .replace(/\s*\r?\n\s*/g, " | ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 600);
}

function write(level, message) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${clean(message)}`;
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.shift();
  console.log(line);
}

export const logger = {
  log: (message) => write("INFO", message),
  warn: (message) => write("WARN", message),
  error: (message) => write("ERROR", message)
};

export function recentLogs(count = 300) {
  return buffer.slice(-Math.max(1, Math.min(MAX_LINES, count)));
}

export function cleanForLog(value, maxLength = 200) {
  return clean(value).slice(0, maxLength);
}

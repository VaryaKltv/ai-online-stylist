import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadLocalEnv(root) {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return;

  readFileSync(envPath, "utf8").split(/\r?\n/).forEach((row) => {
    const line = row.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return;
    const [key, ...valueParts] = line.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  });
}

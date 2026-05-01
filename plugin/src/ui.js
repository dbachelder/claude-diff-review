// Ported from pi-diff-review (https://github.com/badlogic/pi-diff-review)
// Original: src/ui.ts. Inlines web/index.html and web/app.js into a single HTML doc.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, "..", "web");

function escapeForInlineScript(value) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function buildReviewHtml(data) {
  const templateHtml = readFileSync(join(webDir, "index.html"), "utf8");
  const appJs = readFileSync(join(webDir, "app.js"), "utf8");
  const payload = escapeForInlineScript(JSON.stringify(data));
  return templateHtml
    .replace("__INLINE_DATA__", payload)
    .replace("__INLINE_JS__", appJs);
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [css, ambient, store] = await Promise.all([
  readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  readFile(new URL("../src/components/ambient/AmbientBackground.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/store.ts", import.meta.url), "utf8"),
]);

assert.match(css, /\.glass\s*\{[^}]*--glass-opacity/s, "卡片透明度应使用独立玻璃变量");
assert.match(css, /\.glass\s*\{[^}]*backdrop-filter:\s*blur\(6px\);/s, "卡片玻璃应保持固定 6px 模糊");
assert.match(ambient, /blur\(var\(--background-blur, 30px\)\)/, "背景图应使用背景模糊变量");
assert.match(store, /setProperty\("--background-blur",/, "保存主题后必须写入背景模糊变量");
assert.match(store, /setProperty\("--glass-opacity",/, "保存主题后必须写入卡片透明度变量");

console.log("background blur binding verified");

import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { extname, join, resolve } from "node:path";

const root = resolve("dist");
const compressible = new Set([".css", ".html", ".js", ".json", ".svg"]);

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }));
  return nested.flat();
}

let sourceBytes = 0;
let brotliBytes = 0;
for (const path of await filesIn(root)) {
  if (!compressible.has(extname(path).toLowerCase()) || path.endsWith(".br") || path.endsWith(".gz")) continue;
  const info = await stat(path);
  // Small entry pages can retain precompressed copies from an earlier release.
  const hasVariant = (await Promise.all([`${path}.gz`, `${path}.br`].map(p => access(p).then(() => true, () => false)))).some(Boolean);
  if (info.size < 1024 && extname(path) !== ".html" && !hasVariant) continue;
  const source = await readFile(path);
  const brotli = brotliCompressSync(source, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const gzip = gzipSync(source, { level: 9 });
  await Promise.all([writeFile(`${path}.br`, brotli), writeFile(`${path}.gz`, gzip)]);
  sourceBytes += source.length;
  brotliBytes += brotli.length;
}

console.log(`Precompressed ${sourceBytes} bytes to ${brotliBytes} Brotli bytes.`);

// compile.ts — CLI entry for the DSL compiler.
// Usage: npm run compile -- <src.dsl> [outDir]
// Emits engine-loadable JSON (data/<type>/<id>.json) into outDir.
import * as fs from 'fs';
import { parseSource, compileBlocks, emit } from './dsl';

const src = process.argv[2];
const out = process.argv[3] || 'data_cast/_compiled';

if (!src) {
  console.error('Usage: npm run compile -- <src.dsl> [outDir]');
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`Source not found: ${src}`);
  process.exit(1);
}

const srcText = fs.readFileSync(src, 'utf-8');
const sections = parseSource(srcText);
const out_data = compileBlocks(sections);
const written = emit(out_data, out);
console.log(`Compiled ${sections.length} category sections → ${written.length} files in ${out}`);
for (const f of written) console.log('  ' + f);

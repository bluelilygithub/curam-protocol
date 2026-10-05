// Writes the server's list of plant ids and the name to search photos for. The server holds its own copy so a client can never ask it to look
// up an arbitrary name on a third-party service. A test fails if the copy drifts from the dataset.
//   cd garden-planner && npx vite-node scripts/exportPlantNames.ts ../server/config/plantNames.json
import { writeFileSync } from 'node:fs';
import { PLANTS } from '../src/plants/plants';
import { photoSearchName } from '../src/plants/photoName';

const out = process.argv[2] ?? 'plantNames.json';
const names: Record<string, string> = {};
for (const p of PLANTS) names[p.id] = photoSearchName(p);
writeFileSync(out, `${JSON.stringify(names, null, 1)}\n`, 'utf8');
console.log(`wrote ${Object.keys(names).length} names to ${out}`);

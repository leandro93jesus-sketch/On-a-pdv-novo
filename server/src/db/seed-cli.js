import { getDb, closeDb } from './index.js';
import { seedIfEmpty } from './seed.js';

const result = seedIfEmpty(getDb());
if (result.seeded) {
  console.log(`[onca-pdv] seed: ${result.count} produtos inseridos`);
} else {
  console.log(`[onca-pdv] seed: banco já possui ${result.count} produto(s); nada inserido`);
}
closeDb();

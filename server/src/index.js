import { getDb } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { createApp } from './app.js';
import { getDbPath } from './db/paths.js';

// Garante DB + migrations
getDb();

if (process.env.PDV_SEED !== '0') {
  const result = seedIfEmpty();
  if (result.seeded) {
    console.log(`[onca-pdv] seed: ${result.count} produtos inseridos`);
  }
}

const app = createApp();
const PORT = Number(process.env.PORT || 3001);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[onca-pdv] API em http://localhost:${PORT}`);
    console.log(`[onca-pdv] banco: ${getDbPath()}`);
  });
}

export { app };

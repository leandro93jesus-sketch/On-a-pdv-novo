import { Router } from 'express';
import { APP_NAME, APP_VERSION, APP_BUILD } from '../version.js';
import { getDataDir, getDbPath } from '../db/paths.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'onca-pdv-server',
    name: APP_NAME,
    version: APP_VERSION,
    build: APP_BUILD,
    time: new Date().toISOString(),
    data_dir: process.env.NODE_ENV === 'test' ? undefined : getDataDir(),
    db_path: process.env.NODE_ENV === 'test' ? undefined : getDbPath(),
  });
});

export default router;

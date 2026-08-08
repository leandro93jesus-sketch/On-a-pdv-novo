import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'onca-pdv-server',
    name: 'ONÇA PDV',
    time: new Date().toISOString(),
  });
});

export default router;

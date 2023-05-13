import config from '../config';
import Router from '../../src/Router';

(async function () {
  const router = new Router(config);
  await router.connect();
  const workerId = process.pid;

  await router.on<{ msg: string }>(
    {
      exchange: 'ptm.v3_retail_render',
      type: 'direct',
      routingKey: 'example',
      queue: 'v3_q_render_1',
    },
    {
      prefetch: 1,
      exchange: { durable: true },
    },
    async function (data) {
      console.log(`[RECEIVE]: workerId ${workerId}: `, data);
    }
  );
})();

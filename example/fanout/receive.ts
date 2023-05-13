import config from '../config';
import Router from '../../src/Router';

(async function () {
  const router = new Router(config);
  await router.connect();
  const workerId = process.pid;

  await router.on<{ msg: string }>(
    {
      exchange: 'ptm.retail_render',
      type: 'fanout',
      queue: 'q_render',
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

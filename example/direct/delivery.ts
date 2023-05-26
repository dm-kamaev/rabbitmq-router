import config from '../config';
import Router from '../../src/Router';

(async function () {
  const router = new Router(config);
  await router.connect();
  const workerId = process.pid;
  const routingKey = process.env.routingKey || 'new';

  await router.on<{ msg: string }>(
    {
      exchange: 'order',
      type: 'direct',
      routingKey,
      queue: 'start_delivery',
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

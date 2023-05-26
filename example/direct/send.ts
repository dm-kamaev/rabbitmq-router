import config from '../config';
import Router from '../../src/Router';

(async function () {
  const router = new Router(config);
  await router.connect({ confirm: true });
  const routingKey = process.env.routingKey;
  const result = await router.publish(
    {
      exchange: 'order',
      type: 'direct',
      routingKey,
    },
    {
      exchange: { durable: true },
    },
    { message: `I published to exchange (direct) routingKey (${routingKey}) ${Date.now()} !!!` },
    { persistent: true }
  );

  console.log('RESULT ===> ', result);
  // console.log('RESULT ===> ', result1);
  await router.disconnect();
  process.exit(0);
})();

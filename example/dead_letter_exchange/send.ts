import config from '../config';
import Router from '../../src/Router';

(async function () {
  const router = new Router(config);
  await router.connect();
  const result = await router.publish(
    {
      exchange: 'ptm.v2_retail_render',
      type: 'fanout',
    },
    {
      exchange: { durable: true },
    },
    { message: 'I published to exchange!!! ' + Date.now() },
    { persistent: true }
  );
  console.log('RESULT ===> ', result);
  await router.disconnect();
  process.exit(0);
})();
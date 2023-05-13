import config from '../config';
import Router from '../../src/Router';

(async function () {
  const router = new Router(config);
  await router.connect();
  const workerId = process.pid;

  await router.on<{ msg: string }>(
    {
      exchange: 'ptm.retail_render.dead_letter',
      type: 'topic',
      queue: 'q_render.dead_letter',
      routingKey: '#',
    },
    {
      prefetch: 1,
      exchange: { durable: true },
      queue: { deadLetterExchange: 'ptm.retail_render.dead_letter' },
    },
    async function (data) {
      console.log(`[RECEIVE]: DEAD LETTER workerId ${workerId}: `, data);
    }
  );

  await router.on<{ msg: string }>(
    {
      exchange: 'ptm.v2_retail_render',
      type: 'fanout',
      queue: 'v2_q_render',
    },
    {
      prefetch: 1,
      manualAck: true, // you should manual acknoledgement !!!
      exchange: { durable: true },
      queue: { deadLetterExchange: 'ptm.retail_render.dead_letter' },
    },
    async function (data, { ack: _ack, reject, nack: _nack }) {
      console.log('REJECT data and send to dead letter');
      reject(false);

      // OR
      // console.log('NACK data and send to dead letter');
      // nack({ requeue: false });

      // ack
    }
  );
})();

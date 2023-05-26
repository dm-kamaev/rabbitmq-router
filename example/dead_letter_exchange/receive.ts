import config from '../config';
import Router from '../../src/Router';

(async function () {
  const router = new Router(config);
  await router.connect();
  const workerId = process.pid;

  await router.on<{ msg: string }>(
    {
      exchange: 'order.collected.dead_letter',
      type: 'topic',
      queue: 'start_delivery.dead_letter',
      routingKey: '#',
    },
    {
      prefetch: 1,
      exchange: { durable: true },
    },
    async function (data) {
      console.log(`[RECEIVE]: DEAD LETTER workerId ${workerId}: `, data);
    }
  );

  await router.on<{ msg: string }>(
    {
      exchange: 'order.collected',
      type: 'fanout',
      queue: 'v2_start_delivery',
    },
    {
      prefetch: 1,
      manualAck: true, // you should manual acknoledgement !!!
      exchange: { durable: true },
      queue: { deadLetterExchange: 'order.collected.dead_letter' },
    },
    async function (data, { ack: _ack, reject, nack: _nack }) {
      console.log('[RECEIVE]: REJECT data and send to dead letter');
      reject(false);

      // OR
      // console.log('NACK data and send to dead letter');
      // nack({ requeue: false });

      // ack
    }
  );
})();

// import Client from './Client';
import Router from './Router';

void (async function () {
  // const client = await Client.new({ host: '127.0.0.1', login: 'test', password: 'test' });
  const config = {
    host: '127.0.0.1',
    login: 'test',
    password: 'test',
    port: 5682,
  };
  const { login, password, host, port } = config;
  // const client = await Client.new();
  const router = new Router(`amqp://${login}:${password}@${host}:${port}`);
  await router.connect();
  // console.log('HERE');

  router.onQueue<{ message: string }>('q_test', { prefetch: 1, queue: { durable: true } }, async function (data) {
    console.log(data);
  });

  console.log('Result =', await router.sendToQueue('q_test', { message: 'I send to queue!!!' }, { persistent: true }));

  await router.on<{ message: string }>({ exchange: 'ptm.retail_render', type: 'fanout', queue: 'q_render' }, { prefetch: 1, exchange: { durable: true } }, async function (data) {
    console.log(data);
  });
  // console.log('q', client.send_to_queue('q_render', { message: 'Hello world!!!' }));

  console.log('exchange', await router.publish({ exchange: 'ptm.retail_render', type: 'fanout' }, { exchange: { durable: true } }, { message: 'I published to exchange!!!' }));
  // await router.disconnect();
  // console.log('===', router._channels.length);
  // await router._chForSend.close();
  // for await (const { ch } of router._channels) {
  //   if ('waitForConfirms' in ch) {
  //     await ch.waitForConfirms();
  //   }
  //   await ch.close();
  // }
  // console.log('===', router._channels.length);

  console.log('Result =', await router.sendToQueue('q_test', { message: 'I send to queue!!!' }, { persistent: true }));
  console.log('exchange', await router.publish({ exchange: 'ptm.retail_render', type: 'fanout' }, { exchange: { durable: true } }, { message: 'I published to exchange!!!' }));

  // await new Promise((resolve, _reject) => {
  //   setTimeout(async () => {
  //     console.log(router._channels.length);
  //     resolve(undefined);
  //   // }, 10000);
  //   }, 4000);
  // });
  // const client2 = await Client.new({ host: '127.0.0.1', login: 'test', password: 'test' });
  // console.log(client, client === client2);
})();

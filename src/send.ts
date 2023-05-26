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

  console.log('Result =', await router.sendToQueue('q_test', { message: 'I send to queue!!!' }, { persistent: true }));

  console.log('exchange', await router.publish({ exchange: 'ptm.retail_render', type: 'fanout' }, { exchange: { durable: true } }, { message: 'I published to exchange!!!' }));

  process.exit(0);
})();

import amqplib, { Options } from 'amqplib';

interface IContext {
  // eslint-disable-next-line no-unused-vars
  ack: (allUpTo?: boolean) => void;
  // eslint-disable-next-line no-unused-vars
  nack: (params?: { allUpTo?: boolean; requeue?: boolean | undefined }) => void;
  // eslint-disable-next-line no-unused-vars
  reject: (requeue?: boolean) => void;
  msg: amqplib.ConsumeMessage;
}

interface I_handler<T = Record<any, any>> {
  (
    // eslint-disable-next-line no-unused-vars
    body: T,
    // eslint-disable-next-line no-unused-vars
    request: IContext
  ): Promise<void>;
}

interface Logger {
  log: Console['log'];
  err: Console['log'];
}

type Config = string | amqplib.Options.Connect;

export default class Router {
  // constructor(private _logger: I_logger) { }
  private _logger: Logger;
  private _conn: amqplib.Connection;
  private _state: 'connection' | 'connected' | 'closing' | 'closed' = 'closed';
  public _channels: Array<amqplib.Channel | amqplib.ConfirmChannel>;
  public _chForSend: amqplib.Channel | amqplib.ConfirmChannel;

  // eslint-disable-next-line no-use-before-define
  private static instance: Router;

  static async new(config: Config) {
    if (Router.instance) {
      return Router.instance;
    }

    const router = (Router.instance = new Router(config));
    return await router.connect();
  }

  constructor(private _config: Config) {
    this._logger = {
      log: console.log,
      err: console.log,
    };
  }

  /**
   * @param confirm - this parameter using for create channel of publish (if true then create confirmChannel else default channel)
   */
  async connect({ confirm } = { confirm: false }) {
    if (this._state === 'connection' || this._state === 'connected') {
      return;
    }

    this._state = 'connection';
    this._conn = await amqplib.connect(this._config);
    this._state = 'connected';

    this._conn.on('close', async () => {
      if (this._state === 'closing') {
        return;
      }
      this._channels = [];
      this._state = 'closed';
      setTimeout(async () => {
        await this.connect({ confirm: Boolean(confirm) });
      }, 100);
    });

    this._channels = [];
    this._chForSend = await this.createChannel({ confirm: Boolean(confirm) });
    this._chForSend.on('close', async (...arg) => {
      if (this._state === 'closing') {
        return;
      }
      console.log('Close channel chForSend', arg, this._channels.length);
      this._channels = this._channels.filter((el) => el !== this._chForSend);
      this._chForSend = await this.createChannel({ confirm: Boolean(confirm) });
      console.log('Reopen channel chForSend', this._channels.length);
    });
    return this;
  }

  async disconnect() {
    this._state = 'closing';
    for await (const ch of this._channels) {
      if ('waitForConfirms' in ch) {
        await ch.waitForConfirms();
      }
      await ch.close();
    }
    this._channels = [];
    await this._conn.close();
    this._state = 'closed';
  }

  getConnection() {
    return this._conn;
  }

  async createChannel({ confirm } = { confirm: false }): Promise<amqplib.Channel> {
    const ch = confirm ? await this._conn.createConfirmChannel() : await this._conn.createChannel();
    this._channels.push(ch);
    return ch;
  }

  sendToQueue(q: string, data: string | Buffer | Record<any, any>, options?: Options.Publish) {
    const msg = this._serialize(data);
    return this._chForSend.sendToQueue(q, msg, options);
  }

  async publish(
    {
      exchange,
      type,
      routingKey = '',
    }: {
      exchange: string;
      type: 'direct' | 'fanout' | 'topic';
      routingKey?: string;
    },
    { exchange: exchangeOption }: { exchange: Options.AssertExchange },
    data: string | Buffer | Record<any, any>,
    options?: amqplib.Options.Publish
  ) {
    const ch = this._chForSend;

    await ch.assertExchange(exchange, type, exchangeOption);

    const msg = this._serialize(data);
    const resultOfPulish = ch.publish(exchange, routingKey, msg, options);
    if ('waitForConfirms' in ch) {
      const resultOfConfirm = await ch.waitForConfirms();
      console.log({ resultOfConfirm });
    }
    return resultOfPulish;
  }

  private _serialize(data: string | Buffer | Record<any, any>) {
    return data instanceof Buffer ? data : data instanceof Object ? Buffer.from(JSON.stringify(data)) : Buffer.from(data);
  }

  async onQueue<T>(
    q: string,
    {
      prefetch,
      confirm,
      manualAck = false,
      queue: queueOption,
      consume: consumeOption,
    }: {
      prefetch?: number;
      confirm?: boolean;
      manualAck?: boolean;
      queue?: Options.AssertQueue;
      consume?: Options.Consume;
    },
    handler: I_handler<T>
  ) {
    const ch = await this.createChannel({ confirm: Boolean(confirm) });

    ch.on('close', async () => {
      if (this._state === 'closing') {
        return;
      }
      console.log('Close channel onQueue', this._channels.length);
      this._channels = this._channels.filter((el) => el !== ch);
      await this.onQueue(q, { prefetch, confirm, manualAck, queue: queueOption, consume: consumeOption }, handler);
      console.log('Reopen channel onQueue', this._channels.length);
    });

    if (prefetch) {
      await ch.prefetch(prefetch);
    }
    await ch.assertQueue(q, queueOption);

    if (!consumeOption) {
      // if noAck - false then required manual send ack/nack/reject. If noAck true then amqplib automaticly send  ack
      consumeOption = { noAck: false };
    }
    consumeOption.noAck ||= false;

    ch.consume(
      q,
      async (msg) => {
        if (msg === null) {
          this._logger.err('Consumer for queue "' + q + '" cancelled by server');
          return;
        }
        const strMsg = msg.content.toString();
        try {
          const data = JSON.parse(strMsg);
          await handler(data, new Context(ch, msg));
          if (!consumeOption?.noAck && !manualAck) {
            ch.ack(msg);
          }
        } catch (err: any) {
          this._logger.err({ msg: err, message: strMsg });
          if (!consumeOption?.noAck && !manualAck) {
            ch.reject(msg, false);
          }
        }
      },
      consumeOption
    );
  }

  async on<T>(
    { exchange, type, queue, routingKey = '' }: { exchange: string; type: 'direct' | 'fanout' | 'topic'; queue: string; routingKey?: string },
    {
      prefetch,
      confirm,
      manualAck = false,
      exchange: exchangeOption,
      queue: queueOption,
      consume: consumeOption,
      args,
    }: // ...other
    {
      prefetch?: number;
      confirm?: boolean;
      manualAck?: boolean;
      exchange?: Options.AssertExchange;
      queue?: Options.AssertQueue;
      consume?: Options.Consume;
      args?: Record<any, any>;
    },
    handler: I_handler<T>
  ) {
    const ch = await this.createChannel({ confirm: Boolean(confirm) });

    ch.on('close', async () => {
      if (this._state === 'closing') {
        return;
      }
      console.log('Close channel On', this._channels.length);
      this._channels = this._channels.filter((el) => el !== ch);
      await this.on({ exchange, type, queue, routingKey }, { prefetch, confirm, manualAck, exchange: exchangeOption, queue: queueOption, consume: consumeOption, args }, handler);
      console.log('Reopen channel On', this._channels.length);
    });

    if (prefetch) {
      await ch.prefetch(prefetch);
    }

    await ch.assertExchange(exchange, type, exchangeOption);

    const q = await ch.assertQueue(queue, queueOption);

    this._logger.log(' [*] Waiting for messages in %s. To exit press CTRL+C', q.queue);
    await ch.bindQueue(q.queue, exchange, routingKey, args);

    if (!consumeOption) {
      // if noAck - false then required manual send ack/nack/reject. If noAck true then amqplib automaticly send  ack
      consumeOption = { noAck: false };
    }
    consumeOption.noAck ||= false;

    ch.consume(
      q.queue,
      async (msg) => {
        if (msg === null) {
          this._logger.err('Consumer for queue "' + q + '" cancelled by server');
          return;
        }
        const strMsg = msg.content.toString();
        try {
          const data = JSON.parse(strMsg);
          await handler(data, new Context(ch, msg));
          if (!consumeOption?.noAck && !manualAck) {
            ch.ack(msg);
          }
        } catch (err: any) {
          this._logger.err({ msg: err, message: strMsg });
          if (!consumeOption?.noAck && !manualAck) {
            ch.reject(msg, false);
          }
        }
      },
      consumeOption
    );
  }
}

class Context implements IContext {
  constructor(private readonly _ch: amqplib.Channel, public readonly msg: amqplib.ConsumeMessage) {
    this.ack = this.ack.bind(this);
    this.nack = this.nack.bind(this);
    this.reject = this.reject.bind(this);
  }

  // get headers() {
  //   return this.msg.properties;
  // }

  ack(allUpTo?: boolean) {
    return this._ch.ack(this.msg, allUpTo);
  }

  nack(params?: { allUpTo?: boolean; requeue?: boolean }) {
    return this._ch.nack(this.msg, params?.allUpTo, params?.requeue);
  }

  reject(requeue?: boolean) {
    return this._ch.reject(this.msg, requeue);
  }
}

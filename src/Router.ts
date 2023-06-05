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
  private _state: 'connection' | 'connected' | 'closing' | 'closed' | 'error' = 'closed';
  private _cbError = (error: any | Error): Promise<void> => {};
  public _channels: Array<{ ch: amqplib.Channel | amqplib.ConfirmChannel; binding?: () => Promise<void> }>;
  public _chForSend: amqplib.Channel;
  public _chForConfirmSend: amqplib.ConfirmChannel;

  // eslint-disable-next-line no-use-before-define
  private static instance: Router;

  static async new(config: Config) {
    if (Router.instance) {
      return Router.instance;
    }

    const router = (Router.instance = new Router(config));
    return await router.connect();
  }

  constructor(private _config: Config, private _options: { reconnectTimeSec?: number } = {}) {
    this._options.reconnectTimeSec ||= 1000;
    this._logger = {
      log: console.log,
      err: console.log,
    };
  }

  /**
   * @param confirm - this parameter using for create channel of publish (if true then create confirmChannel else default channel)
   */
  async connect({ confirm } = { confirm: false }) {
    this._state = 'connection';
    this._conn = await amqplib.connect(this._config);
    this._state = 'connected';

    this._conn.on('error', async (error) => {
      console.log('ON ERROR', error);
      this._state = 'error';
      await this._cbError(error);
    });

    this._conn.on('close', async () => {
      console.log('ON CLOSE CONNECTION');
      if (this._state === 'closing') {
        return;
      }
      const oldChannels = this._channels;
      this._channels = [];
      this._state = 'closed';
      const idle = setInterval(async () => {
        if (this._state === 'connection' || this._state === 'connected') {
          console.log('ALREADY RECONNECT OR CONNECTED', this._state);
          return;
        }
        console.log('TRY RECONNECT');
        // reconnect
        try {
          if (await this.connect({ confirm: Boolean(confirm) })) {
            console.log('SUCCESS RECONNECT');
            await this._reopenChannels(oldChannels);
            console.log('SUCCESS REOPEN');
            clearInterval(idle);
          }
        } catch (error) {
          this._state = 'error';
          this._logger.err(error);
        }
      }, this._options.reconnectTimeSec);
    });

    this._channels = [];
    this._chForSend = await this._getOrCreatePublishChannel({ confirm: false });
    this._chForConfirmSend = await this._getOrCreatePublishChannel({ confirm: true });

    this._channels.push({ ch: this._chForSend });
    this._channels.push({ ch: this._chForConfirmSend });
    // this._chForSend.on('close', async (...arg) => {
    //   if (this._state === 'closing') {
    //     return;
    //   }
    //   console.log('Close channel chForSend', arg, this._channels.length);
    //   this._channels = this._channels.filter((el) => el.ch !== this._chForSend);
    //   this._chForSend = await this.createChannel({ confirm: Boolean(confirm) });
    //   console.log('Reopen channel chForSend', this._channels.length);
    // });
    return this;
  }

  private async _reopenChannels(channels: Router['_channels']) {
    for await (const { binding } of channels) {
      if (binding) {
        await binding();
      }
    }
  }

  async disconnect() {
    this._state = 'closing';
    for await (const { ch } of this._channels) {
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

  // async createChannel({ confirm }: { confirm: true }): Promise<amqplib.ConfirmChannel>;
  // async createChannel({ confirm }: { confirm: false }): Promise<amqplib.Channel>;
  async createChannel<TOptions extends { confirm: boolean }>(options: TOptions): Promise<TOptions['confirm'] extends true ? amqplib.ConfirmChannel : amqplib.Channel>;
  async createChannel({ confirm } = { confirm: false }) {
    const ch = confirm ? await this._conn.createConfirmChannel() : await this._conn.createChannel();
    // this._channels.push({ ch });
    return ch;
  }

  sendToQueue(q: string, data: string | Buffer | Record<any, any>, options?: Options.Publish) {
    const msg = this._serialize(data);
    return this._chForSend.sendToQueue(q, msg, options);
  }

  async publishConfirm(
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
    return await this._publish(this._chForConfirmSend, { exchange, type, routingKey }, { exchange: exchangeOption }, data, options);
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
    return await this._publish(this._chForSend, { exchange, type, routingKey }, { exchange: exchangeOption }, data, options);
  }

  private async _getOrCreatePublishChannel<TOptions extends { confirm: boolean }>(options: TOptions): Promise<TOptions['confirm'] extends true ? amqplib.ConfirmChannel : amqplib.Channel>;
  private async _getOrCreatePublishChannel({ confirm } = { confirm: false }): Promise<amqplib.Channel | amqplib.ConfirmChannel> {
    if (confirm) {
      if (!this._chForConfirmSend) {
        this._chForConfirmSend = await this.createChannel({ confirm: true });
      }
      return this._chForConfirmSend;
    } else {
      if (!this._chForSend) {
        this._chForSend = await this.createChannel({ confirm: false });
        // this._chForSend.on('close', async (...arg) => {
        //   if (this._state === 'closing') {
        //     return;
        //   }
        //   console.log('Close channel chForSend', arg, this._channels.length);
        //   this._channels = this._channels.filter((el) => el.ch !== this._chForSend);
        //   this._chForSend = await this.createChannel({ confirm: Boolean(confirm) });
        //   console.log('Reopen channel chForSend', this._channels.length);
        // });
      }
      return this._chForSend;
    }
  }

  private async _publish(
    ch: amqplib.Channel | amqplib.ConfirmChannel,
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
    await ch.assertExchange(exchange, type, exchangeOption);

    const msg = this._serialize(data);
    const resultOfPulish = await ch.publish(exchange, routingKey, msg, options);
    if ('waitForConfirms' in ch) {
      await ch.waitForConfirms();
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
    // ch.on('close', async () => {
    //   if (this._state === 'closing') {
    //     return;
    //   }
    //   console.log('Close channel onQueue', this._channels.length);
    //   this._channels = this._channels.filter((el) => el !== ch);
    //   await this.onQueue(q, { prefetch, confirm, manualAck, queue: queueOption, consume: consumeOption }, handler);
    //   console.log('Reopen channel onQueue', this._channels.length);
    // });
    this._channels.push({
      ch,
      binding: async () => {
        await this.onQueue(q, { prefetch, confirm, manualAck, queue: queueOption, consume: consumeOption }, handler);
      },
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
    this._channels.push({
      ch,
      binding: async () => {
        await this.on({ exchange, type, queue, routingKey }, { prefetch, confirm, manualAck, exchange: exchangeOption, queue: queueOption, consume: consumeOption, args }, handler);
      },
    });
    // ch.on('close', async () => {
    //   if (this._state === 'closing') {
    //     return;
    //   }
    //   console.log('Close channel On', this._channels.length);
    //   this._channels = this._channels.filter((el) => el !== ch);
    //   await this.on({ exchange, type, queue, routingKey }, { prefetch, confirm, manualAck, exchange: exchangeOption, queue: queueOption, consume: consumeOption, args }, handler);
    //   console.log('Reopen channel On', this._channels.length);
    // });

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

  onError(cbError: Router['_cbError']) {
    this._cbError = cbError;
  }
}

class Context implements IContext {
  constructor(private readonly _ch: amqplib.Channel, public readonly msg: amqplib.ConsumeMessage) {
    this.ack = this.ack.bind(this);
    this.nack = this.nack.bind(this);
    this.reject = this.reject.bind(this);
  }

  get properties() {
    return this.msg.properties;
  }

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

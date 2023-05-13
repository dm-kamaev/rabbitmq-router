import amqplib from 'amqplib';

// interface I_instance_rabbitMQ {
//   connect(): Promise<Client>;
//   create_channel(): Promise<amqplib.Channel>;
//   // eslint-disable-next-line no-unused-vars
//   send(q: string, data: Record<any, any>): void;
// }

// let instance: I_instance_rabbitMQ;
// Open: http://127.0.0.1:15672

type TConfig = string | amqplib.Options.Connect;

// export default class Client implements I_instance_rabbitMQ {
export default class Client {
  private _conn: amqplib.Connection;
  private _ch_for_send: amqplib.Channel;

  // eslint-disable-next-line no-use-before-define
  private static instance: Client;

  static async new(config: TConfig) {
    if (Client.instance) {
      return Client.instance;
    }

    const client = (Client.instance = new Client(config));
    return await client.connect();
  }

  private constructor(private _config: TConfig) {}

  async connect() {
    this._conn = await amqplib.connect(this._config);
    this._ch_for_send = await this._conn.createChannel();
    this._ch_for_send.on('close', function () {
      // eslint-disable-next-line prefer-rest-params
      console.log('Close channel ', arguments);
    });
    return this;
  }

  async disconnect() {
    await this._ch_for_send.close();
    await this._conn.close();
  }

  async create_channel(): Promise<amqplib.Channel> {
    return await this._conn.createChannel();
  }

  sendToQueue(q: string, data: string | Buffer | Record<any, any>) {
    const msg = this._serialize(data);
    return this._ch_for_send.sendToQueue(q, msg);
  }

  async publish({ exchange, type, routingKey = '' }: { exchange: string; type: 'direct' | 'fanout' | 'topic'; routingKey?: string }, { durable }: { durable?: boolean }, data: string | Buffer | Record<any, any>, options?: amqplib.Options.Publish) {
    const ch = this._ch_for_send;

    await ch.assertExchange(exchange, type, {
      durable,
    });
    const msg = this._serialize(data);
    return ch.publish(exchange, routingKey, msg, options);
  }

  private _serialize(data: string | Buffer | Record<any, any>) {
    return data instanceof Buffer ? data : data instanceof Object ? Buffer.from(JSON.stringify(data)) : Buffer.from(data);
  }
}

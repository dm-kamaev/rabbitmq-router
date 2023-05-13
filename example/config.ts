const config = {
  host: '127.0.0.1',
  login: 'test',
  password: 'test',
  port: 5682,
};
const { login, password, host, port } = config;

export default `amqp://${login}:${password}@${host}:${port}`;

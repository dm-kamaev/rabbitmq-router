routingKey = "order.ev.confirmed"

# If you want scaling consuming message from direct exchange/queue, you can start another worker with same routing key and queue name. RabbitMQ will be send  message to consumers   (behavior like fanout)
delivery:
	routingKey=$(routingKey) npx ts-node delivery.ts;

notification:
	routingKey=$(routingKey) npx ts-node notification.ts;

send:
	routingKey=$(routingKey) npx ts-node send.ts

send_4:
	routingKey=$(routingKey) npx ts-node send.ts & \
	routingKey=$(routingKey) npx ts-node send.ts & \
	routingKey=$(routingKey) npx ts-node send.ts & \
	routingKey=$(routingKey) npx ts-node send.ts;


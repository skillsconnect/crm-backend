
import amqp from "amqplib";

export async function producerMessage(message,queuename,exchange_name,routing_key) {

  const RABBITMQ_URL = "amqp://localhost";
  const QUEUE_NAME = queuename;
  const EXCHANGE_NAME = exchange_name;
  const ROUTING_KEY = routing_key;

  let connection;
  let channel;

  try {
    // Create connection
    connection = await amqp.connect(RABBITMQ_URL);

    // Create channel
    channel = await connection.createChannel();



    // Assert exchange (durable)
    await channel.assertExchange(EXCHANGE_NAME, "direct", {
      durable: true
    });

    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);

    // Convert message to buffer
    const payload = Buffer.from(JSON.stringify(message));

    // Publish message
    channel.publish(
      EXCHANGE_NAME,
      ROUTING_KEY,
      payload,
      {
        persistent: true, // message survives broker restart
        contentType: "application/json"
      }
    );
    // console.log("Message published:", message);

  } catch (error) {
    console.error("Error publishing message:", error);
  } finally {
    // Graceful shutdown
    setTimeout(async () => {
      if (channel) await channel.close();
      if (connection) await connection.close();
    }, 500);
  }
}
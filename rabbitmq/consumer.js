import amqp from "amqplib";
import CommonModel from "../modules/models/mysql/commonModel/commonModel.js";
import axios from "axios";
const { default: commonModel } = await import(`../modules/models/mysql/commonModel/commonModel.js`);
// import { scheduleExcelSheet } from "../Cron/V1/export_excel.cron.js";
export async function consumerSendMailLog(queuename, exchange_name, routing_key) {
    const RABBITMQ_URL = "amqp://localhost";
    const EXCHANGE_NAME = exchange_name;
    const ROUTING_KEY = routing_key;
    const QUEUE_NAME = queuename;
    let connection;
    let channel;
    try {
        // Create connection
        connection = await amqp.connect(RABBITMQ_URL);
        // Create channel
        channel = await connection.createChannel();

        connection.on("error", () => { });
        channel.on("error", () => { });


        // ✅ declare exchange
        await channel.assertExchange(
            EXCHANGE_NAME,
            "direct",
            { durable: true }
        );
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);

        channel.consume(QUEUE_NAME, async (msg) => {
            if (!msg) return;

            if (msg !== null) {
                const messageContent = msg.content.toString();
                // console.log("Received message:", messageContent);
                const message = JSON.parse(messageContent);
                if (Object.keys(message).length > 0) {
                    // Call the function to process the email log
                    if (await processEmailLog(message)) {
                        console.log("Email log processed successfully.");
                        // Acknowledge message after processing
                        channel.ack(msg);
                    } else {
                        channel.nack(msg, false, false);
                        console.error("Failed to process email log.");
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error consuming messages:", error);
    } finally {
        // Graceful shutdown
        // setTimeout(async () => {
        //   if (channel) await channel.close();
        //   if (connection) await connection.close();
        // }, 500);
    }
}
export async function processEmailLog(message) {
    try {
        const logId = message.id;
        const tableName = message.tableName;
        // Fetch the email log entry from the database
        const logEntries = await CommonModel.getData(
            tableName,
            "*",
            `id = ${logId}`
        );
        const postData = message.emailData;
        if (logEntries.length === 0) {
            console.error(`No email log found with ID: ${logId}`);
            return;
        }
        const logEntry = logEntries[0];
        // Here you would implement the actual email sending logic
        console.log(`Processing email log ID: ${logId} for email: ${logEntry.email_to}`);
        // Simulate email sending...
        // After sending, update the log entry status
        const sendVia = message.sendVia;
        let res;
        if (sendVia == "Brevo") {
            try {
                res = await axios.post('https://api.brevo.com/v3/smtp/email', postData, {
                    headers: {
                        'Accept': 'application/json',
                        'api-key': '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',
                        'content-type': 'application/json'
                    }
                });
            } catch (error) {
                console.error("Error processing email log:", error);
            }
        }
        if (sendVia == "ZeptoMail") {
            const payload = message.emailData;
            try {
                res = await axios.post('https://api.zeptomail.in/v1.1/email', payload, {
                    headers: {
                        'accept': 'application/json',
                        'authorization': 'Zoho-enczapikey PHtE6r0IFOzoiTV++xlT5vS5Q8LyZ4ku9b9gKQARuYgTC6ALTU1T/41+xmDh/h55V/dDF/KZmoJrsbqY4L3UJDm4YWZPXWqyqK3sx/VYSPOZsbq6x00asVQcdEDUUofmc99r1CDVvt7eNA==',
                        'content-type': 'application/json'
                    }
                });
            } catch (error) {
                console.error("Error processing email log:", error);
            }
        }
        let updateRecord;
        if (res.data?.messageId) {
            updateRecord = {
                status: "Sent",
                sending_completed: new Date(),
            }
        } else {
            updateRecord = {
                status: "Failed",
                sending_completed: new Date(),
            }
        }
        const result = await commonModel.updateData(
            tableName,
            updateRecord,
            `id = ${logId}`
        );
        if (result.valueOf() === 0) {
            console.error(`Failed to update email  if log ID: ${logId}`);
            return false;
        } else {
            console.log(`Email log ID: ${logId} updated to Sent status.`);
            return true;
        }

    } catch (error) {
        console.error("Error processing email log:", error);
        return false;
    }
}


export async function consumerExcelToExport(queuename, exchange_name, routing_key) {
    const RABBITMQ_URL = "amqp://localhost";
    const EXCHANGE_NAME = exchange_name;
    const ROUTING_KEY = routing_key;
    const QUEUE_NAME = queuename;
    let connection;
    let channel;
    try {
        // Create connection
        connection = await amqp.connect(RABBITMQ_URL);
        // Create channel
        channel = await connection.createChannel();

          connection.on("error", () => { });
        channel.on("error", () => { });
        // ✅ declare exchange
        await channel.assertExchange(
            EXCHANGE_NAME,
            'direct',
            { durable: true }
        );
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);
        channel.consume(QUEUE_NAME, (msg) => {
            if (msg !== null) {
                const messageContent = msg.content.toString();
                console.log("Received message:", messageContent);
                const message = JSON.parse(messageContent);
                if (Object.keys(message).length > 0) {
                    // Call the function to process the excel export
                    if (processExcelExport(message)) {
                        console.log("Excel export processed successfully.");
                        // Acknowledge message after processing
                        channel.ack(msg);
                    } else {
                        console.error("Failed to process excel export.");
                        channel.nack(msg, false, false);
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error consuming messages:", error);
    } finally {
        // Graceful shutdown
        // setTimeout(async () => {
        //   if (channel) await channel.close();
        //   if (connection) await connection.close();
        // }, 500);
    }
}
export async function processExcelExport(message) {
    try {
        const exportId = message.id;
        console.log(`[Excel Worker] Processing export ID: ${exportId}`);

        // Fetch the excel export entry from the database
        const exportEntries = await CommonModel.getData(
            "ups_schedule_request_automatically",
            "*",
            `id = ${exportId}`
        );

        if (exportEntries.length === 0) {
            console.error(`[Excel Worker] No excel export found with ID: ${exportId}`);
            return false;
        }

        const exportEntry = exportEntries[0];

        // Validate the entry is still pending or queued
        if (!['Pending', 'Queued'].includes(exportEntry.status)) {
            console.log(`[Excel Worker] Export ID ${exportId} already processed (status: ${exportEntry.status})`);
            return true;
        }

        console.log(`[Excel Worker] Starting export for user: ${exportEntry.user_id}`);

        // Update status to Processing
        await commonModel.updateData(
            "ups_schedule_request_automatically",
            {
                status: "Started",//Started //Processing
                started_on: new Date()
            },
            `id = '${exportId}'`
        );

        // Dynamically import and execute the Excel generation
        const { scheduleExcelSheet } = await import("../Cron/V1/export_excel.cron.js");

        // Pass the export ID to the function so it can fetch this specific record
        await scheduleExcelSheet(exportId);

        console.log(`[Excel Worker] Successfully completed export ID: ${exportId}`);
        return true;

    } catch (error) {
        console.error(`[Excel Worker] Error processing excel export ID ${message.id}:`, error);

        // Update status to Failed
        try {
            await commonModel.updateData(
                "ups_schedule_request_automatically",
                {
                    status: "Failed",
                    executed_on: new Date(),
                    error_message: error.message || 'Unknown error'
                },
                `id = '${message.id}'`
            );
        } catch (updateError) {
            console.error(`[Excel Worker] Failed to update error status:`, updateError);
        }

        return false;
    }
}


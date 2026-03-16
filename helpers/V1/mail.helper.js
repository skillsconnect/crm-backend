import axios from 'axios';
const environment = process.env.NODE_ENV || 'development';
// import commonModel from "../../../Models/MySQL/commonModel.js";

const VERSION = process.env.WEBSITE_VERSION;
const { default: commonModel } = await import(
  `../../../Modules/Models/Website/MySQL/commonModel/commonModel.js`

);
const { producerMessage } = await import(`../../../rabbitmq/producer.js`);

const provider = 'brevo';
// const provider = 'zepto';
async function sendMail({
  emailFrom = 'noreply@skillsconnect.co.in',
  emailTo,
  emailCc = null,
  subject,
  mailBody,
  attachments = null,
  replyTo = null, // default provider
  purpose,
  userId,
  createdBy
}) {
  // console.log("sendMail called with:", { emailFrom, emailTo, subject, purpose });
  if (!emailTo || !subject || !mailBody) {
    throw new Error('Required email details are missing.');
  }

  // Log email info in development mode but continue to send email
  if (environment === 'development') {
    console.log(`[DEV] Email to: ${emailTo}, Subject: ${subject}`);
    // Removed the "return true" so we continue with email sending
  }

  if (environment === 'staging') subject = `Staging: ${subject}`;
  else if (environment === 'pre-prod') subject = `Pre-prod: ${subject}`;



  if (provider === 'zepto') {
    return sendMailViaZepto({ emailFrom, emailTo, emailCc, subject, mailBody, attachments, replyTo, purpose, tableName: "ups_email_logs" ,userId, createdBy});
  } else if (provider === 'brevo') {
    return sendMailViaBrevo({ emailFrom, emailTo, emailCc, subject, mailBody, attachments, replyTo, purpose, tableName: "ups_email_logs" ,userId, createdBy});
  } else {
    throw new Error(`Unknown mail provider: ${provider}`);
  }
}
async function sendInstantMail({
  emailFrom = 'noreply@skillsconnect.co.in',
  emailTo,
  emailCc = null,
  subject,
  mailBody,
  attachments = null,
  replyTo = null, // default provider
  purpose,
  userId,
  createdBy
}) {
  // console.log("sendInstantMail called with:", { emailFrom, emailTo, subject, purpose });
  if (!emailTo || !subject || !mailBody) {
    throw new Error('Required email details are missing.');
  }

  // Log email info in development mode but continue to send email
  if (environment === 'development') {
    console.log(`[DEV] Email to: ${emailTo}, Subject: ${subject}`);
    // Removed the "return true" so we continue with email sending
  }

  if (environment === 'staging') subject = `Staging: ${subject}`;
  else if (environment === 'pre-prod') subject = `Pre-prod: ${subject}`;



  if (provider === 'zepto') {
    return sendMailViaZepto({ emailFrom, emailTo, emailCc, subject, mailBody, attachments, replyTo, purpose, tableName: "ups_instant_email_logs", userId, createdBy });
  } else if (provider === 'brevo') {
    return sendMailViaBrevo({ emailFrom, emailTo, emailCc, subject, mailBody, attachments, replyTo, purpose, tableName: "ups_instant_email_logs", userId, createdBy });
  } else {
    throw new Error(`Unknown mail provider: ${provider}`);
  }
}

async function sendMailViaZepto({ emailFrom, emailTo, emailCc, subject, mailBody, attachments, replyTo, purpose, tableName, userId, createdBy }) {

  subject = (process.env.ENVIRONMENT != "PRODUCTION" ? "STAGING-"+subject : subject)
  const payload = {
    from: { address: emailFrom },
    to: emailTo.split(',').map(email => ({ email_address: { address: email.trim(), name: email.trim() } })),
    subject,
    htmlbody: mailBody,
    reply_to: {
      address: replyTo || 'noreply@skillsconnect.co.in',
      name: 'Skills Connect'
    },
    cc: emailCc ? emailCc.split(',').map(email => ({ email_address: { address: email.trim(), name: email.trim() } })) : undefined,
    attachments: attachments ? attachments.split(',').map(url => ({ file_url: url.trim() })) : undefined
  };

  try {
    // const res = await axios.post('https://api.zeptomail.in/v1.1/email', payload, {
    //   headers: {
    //     'accept': 'application/json',
    //     'authorization': 'Zoho-enczapikey PHtE6r0IFOzoiTV++xlT5vS5Q8LyZ4ku9b9gKQARuYgTC6ALTU1T/41+xmDh/h55V/dDF/KZmoJrsbqY4L3UJDm4YWZPXWqyqK3sx/VYSPOZsbq6x00asVQcdEDUUofmc99r1CDVvt7eNA==',
    //     'content-type': 'application/json'
    //   }
    // });
    // insert data in logs
    const logData = {
      status: "Pending",
      sending_started: new Date(),
      // sending_completed: new Date(),
      email_to: emailTo,
      email_from: emailFrom,
      purpose: purpose || 'General',
      user_id: userId ?? 1,
      subject: subject,
      email_body: mailBody,
      created_on: new Date(),
      created_by: createdBy ?? 1,
      updated_by: createdBy ?? 1,
      updated_on: new Date(),

    }

    // producer code  for rabbitmq

    if (tableName === "ups_email_logs") {
      const insertData = await commonModel.insertData("ups_email_logs", logData);
      const message = { id: insertData, tableName: tableName, action: "sendMailFromLogTable", sendVia: "ZeptoMail", emailData: payload };
      producerMessage(message, "send_email_log_queue", "notifications_exchange", "email_log_notification");

    } else if (tableName === "ups_instant_email_logs") {
      const insertData = await commonModel.insertData("ups_instant_email_logs", logData);
      const message = { id: insertData, tableName: tableName, action: "sendMailFromLogTable", sendVia: "ZeptoMail", emailData: payload };
      producerMessage(message, "send_email_instant_log_queue", "notifications_exchange", "email_instant_log_notification");

    }
    return true;
  } catch (error) {
    console.error('ZeptoMail Error:', error.response?.data || error.message);
    return false;
  }
}

async function sendMailViaBrevo({ emailFrom, emailTo, emailCc, subject, mailBody, attachments, replyTo, purpose, tableName ,userId, createdBy}) {
  subject = (process.env.ENVIRONMENT != "PRODUCTION" ? "STAGING-"+subject : subject)
  const postData = {
    sender: { name: 'Skills Connect', email: emailFrom },
    to: emailTo.split(',').map(email => ({ email: email.trim() })),
    subject,
    htmlContent: mailBody,
    replyTo: {
      email: replyTo || 'support@skillsconnect.in',
      name: 'Skills Connect'
    },
    cc: emailCc ? emailCc.split(',').map(email => ({ email: email.trim() })) : undefined,
    attachment: attachments ? attachments.split(',').map(url => ({ url: url.trim() })) : undefined
  };

  try {

    const logData = {
      status: "Pending",
      sending_started: new Date(),
      // sending_completed: new Date(),
      email_to: emailTo,
      email_from: emailFrom,
      purpose: purpose || 'General',
      user_id: userId ?? 1,
      subject: subject,
      email_body: mailBody,
      created_on: new Date(),
      created_by: createdBy ?? 1,
      updated_by: createdBy ?? 1,
      updated_on: new Date(),
    }


    // producer code  for rabbitmq

    if (tableName === "ups_email_logs") {
      const insertData = await commonModel.insertData("ups_email_logs", logData);
      const message = { id: insertData, tableName: tableName, action: "sendMailFromLogTable", sendVia: "Brevo", emailData: postData };
      producerMessage(message, "send_email_log_queue", "notifications_exchange", "email_log_notification");

    } else if (tableName === "ups_instant_email_logs") {
      const insertData = await commonModel.insertData("ups_instant_email_logs", logData);
      const message = { id: insertData, tableName: tableName, action: "sendMailFromLogTable", sendVia: "Brevo", emailData: postData };
      producerMessage(message, "send_email_instant_log_queue", "notifications_exchange", "email_instant_log_notification");

    }
    return true;
  } catch (error) {
    console.error('Brevo Error:', error.response?.data || error.message);
    return false;
  }
}

export { sendMail,sendInstantMail };

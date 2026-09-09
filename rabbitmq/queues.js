// Central list of the RabbitMQ queue names this service owns. The `_crm`
// suffix namespaces them so this CRM's workers don't collide with other apps
// that share the same broker (they historically used unsuffixed names like
// `send_email_log_queue`).
//
// Note: renaming declares *new* durable queues on the broker. Any messages
// still sitting in the old queues won't migrate automatically — drain or
// delete the old queues once every producer/consumer here is on the new names.

export const QUEUES = {
    EMAIL_LOG: 'send_email_log_queue_crm',
    EMAIL_INSTANT_LOG: 'send_email_instant_log_queue_crm',
    EMAIL_EXCEL_EXPORT: 'send_email_excel_export_queue_crm',
};

export default QUEUES;

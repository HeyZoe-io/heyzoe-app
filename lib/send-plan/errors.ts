/** sendBusinessTemplate error for a recipient skip. Callers close the event (templateFailureDispatch → skipped). */
export const SEND_CHECK_SKIPPED_ERROR = "send_check_skipped";

/** The run's own trainer queue row, sent at PLAN: the planned row is the real send. */
export const PLAN_SUPERSEDED_REASON = "superseded_by_plan";

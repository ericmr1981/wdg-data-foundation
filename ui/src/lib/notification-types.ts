export type NotificationType =
  | 'data_stale'
  | 'unmatched_txn'
  | 'dup_rule'
  | 'monthly_report';

export type Severity = 'info' | 'warn' | 'error';

export interface NotificationItem {
  id: number;
  type: NotificationType;
  brand_code: string | null;
  severity: Severity;
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  related_id: number | null;
  created_at: string;
  is_read: boolean;
}

export interface NotificationListResponse {
  unread_count: number;
  items: NotificationItem[];
}

import { ExecutionContext } from '@cloudflare/workers-types';

export interface Monitor {
  id: number;
  name: string;
  url: string;
  method: string;
  request_headers: string | null; // JSON 格式自定义请求头
  request_body: string | null;    // POST 请求体
  interval: number;
  status: 'UP' | 'DOWN' | 'RETRYING' | 'PAUSED';
  retry_count: number;
  last_check: string | null;
  keyword: string | null;
  user_agent: string | null;
  tags: string | null;            // 逗号分隔标签
  domain_expiry: string | null;
  cert_expiry: string | null;
  check_info_status: string | null;
  paused: number;
  check_ssl: number;
  check_domain: number;
  alert_silence_uptime: number;
  alert_silence_ssl: number;
  alert_silence_domain: number;
  alert_error_rate: number;       // 错误率阈值告警百分比 (0=关闭)
  last_alert_uptime: string | null;
  last_alert_ssl: string | null;
  last_alert_domain: string | null;
  expected_codes: string | null;   // 期望 HTTP 状态码模式，如 "200-299" 或 "200,301,302"
  channel_ids: string | null;      // 专属通知渠道 ID，如 "1,3"
  sort_order: number;             // 拖拽排序顺序
  created_at: string;
}

export interface Log {
  id: number;
  monitor_id: number;
  status_code: number;
  latency: number;
  is_fail: number;
  reason: string | null;
  created_at: string;
}

export interface DingTalkResult {
  errcode: number;
  errmsg: string;
}

export interface NotificationChannel {
  id: number;
  type: 'dingtalk' | 'wecom' | 'feishu' | 'telegram' | 'webhook' | 'email';
  name: string;
  enabled: number;
  config: string;
  created_at: string;
}

export interface Incident {
  id: number;
  title: string;
  description: string | null;
  severity: 'info' | 'warning' | 'critical';
  status: 'active' | 'resolved';
  type: 'incident' | 'maintenance';
  scheduled_start: string | null;
  scheduled_end: string | null;
  affected_monitors: string | null;  // 逗号分隔的监控 ID
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export type Bindings = {
  DB: D1Database;
  DINGTALK_ACCESS_TOKEN?: string;
  DINGTALK_SECRET?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_API_KEY?: string;    // API 密钥认证（优先级高于密码）
  ALLOWED_ORIGIN?: string;
  SESSION_TTL_HOURS?: string;
};

export const MONITOR_COLUMNS = `
  id, name, url, method, request_headers, request_body, interval, status,
  retry_count, last_check, keyword, user_agent, tags, domain_expiry, cert_expiry,
  check_info_status, paused, check_ssl, check_domain, alert_silence_uptime,
  alert_silence_ssl, alert_silence_domain, alert_error_rate, last_alert_uptime,
  last_alert_ssl, last_alert_domain, expected_codes, channel_ids, sort_order, created_at
`;

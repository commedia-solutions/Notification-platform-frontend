const DEFAULT_API_BASE = import.meta.env.DEV
  ? "/api/v1"
  : "https://signalops-api.iot-cspllabs.com/api/v1";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(
  /\/$/,
  "",
);

type ApiEnvelope<T> = { ok: true; data: T; meta?: Record<string, unknown> };
type ApiFailure = {
  ok?: false;
  error?: { code?: string; message?: string; details?: unknown };
};

export class SignalOpsApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "SignalOpsApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken =
  sessionStorage.getItem("signalops.accessToken") ||
  localStorage.getItem("signalops.accessToken") ||
  "";
let persistentSession = Boolean(localStorage.getItem("signalops.accessToken"));
let refreshPromise: Promise<boolean> | null = null;

function saveAccessToken(token: string, remember = persistentSession) {
  accessToken = token;
  persistentSession = remember;
  sessionStorage.removeItem("signalops.accessToken");
  localStorage.removeItem("signalops.accessToken");
  (remember ? localStorage : sessionStorage).setItem(
    "signalops.accessToken",
    token,
  );
}

function clearAccessToken() {
  accessToken = "";
  sessionStorage.removeItem("signalops.accessToken");
  localStorage.removeItem("signalops.accessToken");
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as
    | ApiEnvelope<T>
    | ApiFailure;
  if (!response.ok || !("ok" in payload) || payload.ok !== true) {
    const failure = payload as ApiFailure;
    throw new SignalOpsApiError(
      response.status,
      failure.error?.code || "REQUEST_FAILED",
      failure.error?.message || "The request could not be completed",
      failure.error?.details,
    );
  }
  return payload.data;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/admin/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const data = await parseResponse<{ accessToken: string }>(response);
        saveAccessToken(data.accessToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new SignalOpsApiError(
      0,
      "API_UNREACHABLE",
      "Unable to reach the SignalOps API. Check the API connection and try again.",
    );
  }
  if (response.status === 401 && retry && (await refreshSession()))
    return request<T>(path, init, false);
  return parseResponse<T>(response);
}

const body = (value: unknown) => JSON.stringify(value);

export type LoginContext = {
  accessToken: string;
  expiresIn: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    accountType: "admin";
    roles: ApiRole[];
    permissions: string[];
  };
  tenant: { id: string; name: string; slug: string };
};

export type ApiAuthContext = {
  id: string;
  full_name: string;
  email: string;
  account_type: "admin";
  status: "active";
  is_platform_admin: boolean;
  tenant_id: string;
  role: string;
  tenant_name: string;
  tenant_slug: string;
  permissions: string[];
};

export type ApiWorkspace = {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    timezone: string;
  };
  counts: {
    users: number;
    employees: number;
    facilities: number;
    active_alerts: number;
  };
  settings: ApiTenantSettings;
  user: { id: string; tenant_id: string; role: string; permissions: string[] };
};

export type ApiUser = {
  id: string;
  full_name: string;
  email: string;
  phone_e164: string | null;
  account_type: "admin" | "employee";
  status: "invited" | "active" | "suspended" | "disabled";
  last_login_at: string | null;
  employee_code: string | null;
  job_title: string | null;
  department_id: string | null;
  department_name: string | null;
  facility_id: string | null;
  facility_name: string | null;
  building_id: string | null;
  building_name: string | null;
  roles: { id: string; name: string; audience: "portal" | "employee" }[];
};

export type ApiDepartment = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  employee_count: number;
};
export type ApiBuilding = {
  id: string;
  name: string;
  description?: string | null;
  musterPointName?: string | null;
  musterPointInstructions?: string | null;
  mapX?: string | number | null;
  mapY?: string | number | null;
  mapWidth?: string | number | null;
  mapHeight?: string | number | null;
  employeeCount?: number;
};
export type ApiFacility = {
  id: string;
  tenant_id: string;
  name: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  status: "connected" | "offline" | "maintenance";
  employee_count: number;
  buildings: ApiBuilding[];
};
export type ApiGroup = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  member_ids: string[];
};
export type ApiCategory = {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
};
export type ApiTemplate = {
  id: string;
  tenant_id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  alert_level: "critical" | "advisory" | "information";
  title_template: string;
  message_template: string;
  require_acknowledgement: boolean;
  is_active: boolean;
  version: number;
  channels: ("sms" | "email" | "push")[] | string;
};
export type ApiAlert = {
  id: string;
  public_id: string;
  alert_level: "critical" | "advisory" | "information";
  title: string;
  message: string;
  status: string;
  require_acknowledgement: boolean;
  approval_required: boolean;
  created_at: string;
  started_at: string | null;
  resolved_at: string | null;
  created_by_name: string;
  recipients: number;
  sent: number;
  delivered: number;
  retrying: number;
  failed: number;
  acknowledged: number;
  channels: ("sms" | "email" | "push")[] | string;
  audience_names: string;
};
export type ApiAlertDelivery = {
  id: string;
  channel: "sms" | "email" | "push";
  status:
    | "queued"
    | "processing"
    | "sent"
    | "delivered"
    | "failed"
    | "skipped";
  provider: string | null;
  providerMessageId: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  outboxStatus: "pending" | "processing" | "completed" | "failed" | "cancelled" | null;
  outboxAttemptCount: number | null;
  outboxRunAfter: string | null;
  outboxLastError: string | null;
  attempts: {
    id: string;
    delivery_id: string;
    attempt_number: number;
    response_status: number | null;
    error_code: string | null;
    duration_ms: number | null;
    attempted_at: string;
  }[];
};
export type ApiAlertRecipientDetail = {
  id: string;
  user_id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
  facility_name: string | null;
  building_name: string | null;
  acknowledgement_status: string | null;
  acknowledgement_source: string | null;
  note: string | null;
  acknowledged_at: string | null;
  deliveries: ApiAlertDelivery[];
};
export type ApiAlertApproval = {
  id: string;
  reviewer_id: string;
  reviewer_name: string;
  decision: "approved" | "returned";
  note: string | null;
  created_at: string;
};
export type ApiAlertDetail = Omit<
  ApiAlert,
  "recipients" | "sent" | "delivered" | "retrying" | "failed" | "acknowledged"
> & {
  created_by: string;
  approved_by_name: string | null;
  resolved_by_name: string | null;
  cancelled_by_name: string | null;
  approved_at: string | null;
  submitted_at: string | null;
  cancelled_at: string | null;
  recipient_count: number;
  sent_count: number;
  delivered_count: number;
  retrying_count: number;
  failed_count: number;
  acknowledged_count: number;
  channels: ("sms" | "email" | "push")[];
  audiences: {
    id: string;
    audience_type: string;
    reference_id: string | null;
    display_name: string;
  }[];
  recipients: ApiAlertRecipientDetail[];
  approvals: ApiAlertApproval[];
  assistance: ApiAssistanceRequest[];
  audit: ApiAuditEvent[];
};
export type ApiAssistanceRequest = {
  id: string;
  alert_recipient_id: string;
  user_id: string;
  employee_name: string;
  status: "open" | "assigned" | "resolved" | "cancelled";
  note: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
};
export type ApiAuditEvent = {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};
export type ApiAlertResponse = {
  alert_recipient_id: string;
  user_id: string;
  full_name: string;
  department_name: string | null;
  facility_name: string | null;
  building_name: string | null;
  status: "acknowledged" | "safe" | "needs_assistance" | "awaiting_response";
  note: string | null;
  acknowledged_at: string | null;
  assistance_id: string | null;
  assistance_status: string | null;
};
export type ApiRole = {
  id: string;
  name: string;
  description: string | null;
  audience: "portal" | "employee";
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
  user_count: number;
};
export type ApiPermission = {
  code: string;
  description: string;
  audience: "portal" | "employee";
};
export type ApiTenantSettings = {
  tenant_id: string;
  require_critical_acknowledgement: boolean;
  critical_alert_approval: boolean;
  non_response_escalation_minutes: number;
};
export type ApiChannelSetting = {
  id: string;
  channel: "sms" | "email" | "push";
  provider: string;
  sender_identity: string | null;
  configuration: Record<string, unknown>;
  is_enabled: boolean;
};

export const api = {
  hasAccessToken: () => Boolean(accessToken),
  async restore() {
    if (!accessToken && !(await refreshSession())) return null;
    try {
      return await request<ApiAuthContext>("/auth/admin/me");
    } catch {
      clearAccessToken();
      return null;
    }
  },
  async login(email: string, password: string, remember: boolean) {
    const data = await request<LoginContext>(
      "/auth/admin/login",
      { method: "POST", body: body({ email, password }) },
      false,
    );
    saveAccessToken(data.accessToken, remember);
    return data;
  },
  async logout() {
    try {
      await request<void>(
        "/auth/admin/logout",
        { method: "POST", body: "{}" },
        false,
      );
    } finally {
      clearAccessToken();
    }
  },
  validateInvitation: (token: string) =>
    request<{
      status: "valid" | "completed" | "expired";
      audience: "portal" | "employee";
      expires_at: string;
      email: string;
      full_name: string;
      tenant_name: string;
    }>(
      "/auth/activate/validate",
      { method: "POST", body: body({ token }) },
      false,
    ),
  activateAccount: (token: string, password: string) =>
    request<{
      accountType: string;
      audience: string;
      email: string;
      activated: boolean;
    }>(
      "/auth/activate",
      { method: "POST", body: body({ token, password }) },
      false,
    ),
  forgotPassword: (email: string) =>
    request<{ message: string }>(
      "/auth/forgot-password",
      { method: "POST", body: body({ email }) },
      false,
    ),
  verifyPasswordReset: (email: string, otp: string) =>
    request<{ resetToken: string }>(
      "/auth/forgot-password/verify",
      { method: "POST", body: body({ email, otp }) },
      false,
    ),
  resetPassword: (token: string, password: string) =>
    request<{ reset: boolean }>(
      "/auth/reset-password",
      { method: "POST", body: body({ token, password }) },
      false,
    ),
  workspace: () => request<ApiWorkspace>("/admin/workspace"),
  users: () => request<ApiUser[]>("/admin/users"),
  createUser: (value: unknown) =>
    request<ApiUser>("/admin/users", { method: "POST", body: body(value) }),
  updateUser: (id: string, value: unknown) =>
    request<ApiUser>(`/admin/users/${id}`, {
      method: "PATCH",
      body: body(value),
    }),
  deleteUser: (id: string) =>
    request<void>(`/admin/users/${id}`, { method: "DELETE" }),
  resendInvitation: (id: string) =>
    request<{ sent: boolean }>(`/admin/users/${id}/resend-invitation`, {
      method: "POST",
      body: "{}",
    }),
  departments: () => request<ApiDepartment[]>("/admin/departments"),
  createDepartment: (value: unknown) =>
    request<ApiDepartment>("/admin/departments", {
      method: "POST",
      body: body(value),
    }),
  updateDepartment: (id: string, value: unknown) =>
    request<ApiDepartment>(`/admin/departments/${id}`, {
      method: "PATCH",
      body: body(value),
    }),
  deleteDepartment: (id: string) =>
    request<void>(`/admin/departments/${id}`, { method: "DELETE" }),
  facilities: () => request<ApiFacility[]>("/admin/facilities"),
  createFacility: (value: unknown) =>
    request<ApiFacility>("/admin/facilities", {
      method: "POST",
      body: body(value),
    }),
  updateFacility: (id: string, value: unknown) =>
    request<ApiFacility>(`/admin/facilities/${id}`, {
      method: "PATCH",
      body: body(value),
    }),
  deleteFacility: (id: string) =>
    request<void>(`/admin/facilities/${id}`, { method: "DELETE" }),
  createBuilding: (facilityId: string, value: unknown) =>
    request<ApiBuilding>(`/admin/facilities/${facilityId}/buildings`, {
      method: "POST",
      body: body(value),
    }),
  updateBuilding: (id: string, value: unknown) =>
    request<ApiBuilding>(`/admin/buildings/${id}`, {
      method: "PATCH",
      body: body(value),
    }),
  deleteBuilding: (id: string) =>
    request<void>(`/admin/buildings/${id}`, { method: "DELETE" }),
  groups: () => request<ApiGroup[]>("/admin/groups"),
  createGroup: (value: unknown) =>
    request<ApiGroup>("/admin/groups", { method: "POST", body: body(value) }),
  updateGroup: (id: string, value: unknown) =>
    request<ApiGroup>(`/admin/groups/${id}`, {
      method: "PATCH",
      body: body(value),
    }),
  deleteGroup: (id: string) =>
    request<void>(`/admin/groups/${id}`, { method: "DELETE" }),
  categories: () => request<ApiCategory[]>("/admin/template-categories"),
  createCategory: (value: unknown) =>
    request<ApiCategory>("/admin/template-categories", {
      method: "POST",
      body: body(value),
    }),
  templates: () => request<ApiTemplate[]>("/admin/templates"),
  createTemplate: (value: unknown) =>
    request<ApiTemplate>("/admin/templates", {
      method: "POST",
      body: body(value),
    }),
  updateTemplate: (id: string, value: unknown) =>
    request<ApiTemplate>(`/admin/templates/${id}`, {
      method: "PATCH",
      body: body(value),
    }),
  deleteTemplate: (id: string) =>
    request<void>(`/admin/templates/${id}`, { method: "DELETE" }),
  alerts: () => request<ApiAlert[]>("/admin/alerts?limit=100"),
  alert: (id: string) => request<ApiAlertDetail>(`/admin/alerts/${id}`),
  alertAudit: (id: string) =>
    request<ApiAuditEvent[]>(`/admin/alerts/${id}/audit`),
  createAlert: (value: unknown) =>
    request<ApiAlert & { recipientCount: number; deliveryCount: number }>(
      "/admin/alerts",
      { method: "POST", body: body(value) },
    ),
  updateAlert: (id: string, value: { message: string }) =>
    request<{ id: string; status: string; message: string }>(`/admin/alerts/${id}`, {
      method: "PATCH",
      body: body(value),
    }),
  approveAlert: (id: string) =>
    request(`/admin/alerts/${id}/approve`, { method: "POST", body: "{}" }),
  submitAlert: (id: string) =>
    request(`/admin/alerts/${id}/submit`, { method: "POST", body: "{}" }),
  returnAlert: (id: string, note: string) =>
    request(`/admin/alerts/${id}/return`, {
      method: "POST",
      body: body({ note }),
    }),
  releaseAlert: (id: string) =>
    request(`/admin/alerts/${id}/release`, { method: "POST", body: "{}" }),
  resolveAlert: (id: string) =>
    request(`/admin/alerts/${id}/resolve`, { method: "POST", body: "{}" }),
  cancelAlert: (id: string) =>
    request(`/admin/alerts/${id}/cancel`, { method: "POST", body: "{}" }),
  alertResponses: (id: string) =>
    request<ApiAlertResponse[]>(`/admin/alerts/${id}/responses`),
  remindAlertRecipients: (id: string, userIds?: string[]) =>
    request<{ queued: boolean; jobId: string }>(
      `/admin/alerts/${id}/reminders`,
      { method: "POST", body: body({ userIds }) },
    ),
  updateAssistance: (id: string, value: unknown) =>
    request(`/admin/assistance/${id}`, { method: "PATCH", body: body(value) }),
  roles: () => request<ApiRole[]>("/admin/roles"),
  permissions: () => request<ApiPermission[]>("/admin/permissions"),
  createRole: (value: unknown) =>
    request<ApiRole>("/admin/roles", { method: "POST", body: body(value) }),
  updateRole: (id: string, value: unknown) =>
    request<ApiRole>(`/admin/roles/${id}`, {
      method: "PATCH",
      body: body(value),
    }),
  deleteRole: (id: string) =>
    request<void>(`/admin/roles/${id}`, { method: "DELETE" }),
  settings: () =>
    request<{ preferences: ApiTenantSettings; channels: ApiChannelSetting[] }>(
      "/admin/settings",
    ),
  updateSettings: (value: unknown) =>
    request<ApiTenantSettings>("/admin/settings", {
      method: "PATCH",
      body: body(value),
    }),
  updateChannel: (channel: string, value: unknown) =>
    request<ApiChannelSetting>(`/admin/settings/channels/${channel}`, {
      method: "PUT",
      body: body(value),
    }),
  audit: () => request<ApiAuditEvent[]>("/admin/audit"),
};

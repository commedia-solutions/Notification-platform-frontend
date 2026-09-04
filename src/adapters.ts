import type {
  ApiAlert,
  ApiDepartment,
  ApiFacility,
  ApiGroup,
  ApiTemplate,
  ApiUser,
  ApiWorkspace,
} from "./api";
import type {
  AudienceGroup,
  Broadcast,
  Channel,
  Department,
  Facility,
  MessageTemplate,
  Recipient,
  Severity,
  Tenant,
} from "./types";

const numberValue = (
  value: string | number | null | undefined,
  fallback: number,
) => (value == null ? fallback : Number(value));
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const severity = (
  value: ApiAlert["alert_level"] | ApiTemplate["alert_level"],
): Severity =>
  value === "advisory"
    ? "warning"
    : value === "information"
      ? "info"
      : "critical";
const channelValues = (
  values: ("sms" | "email" | "push")[] | string | null | undefined,
): ("sms" | "email" | "push")[] => {
  if (Array.isArray(values)) return values;
  if (!values) return [];
  return values
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter(
      (value): value is "sms" | "email" | "push" =>
        value === "sms" || value === "email" || value === "push",
    );
};
const channels = (
  values: ("sms" | "email" | "push")[] | string | null | undefined,
): Channel[] =>
  channelValues(values).map((value) =>
    value === "push" ? "android" : value,
  );
const timestamp = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function tenantFromApi(workspace: ApiWorkspace): Tenant {
  return {
    id: workspace.tenant.id,
    slug: workspace.tenant.slug,
    name: workspace.tenant.name,
    shortName: initials(workspace.tenant.name),
    plan: "Customer organisation",
    facilities: workspace.counts.facilities,
    people: workspace.counts.employees,
  };
}

export function recipientFromApi(user: ApiUser, tenantId: string): Recipient {
  return {
    id: user.id,
    tenantId,
    name: user.full_name,
    initials: initials(user.full_name),
    email: user.email,
    phone: user.phone_e164 || "",
    role:
      user.job_title ||
      user.roles[0]?.name ||
      (user.account_type === "admin" ? "Administrator" : "Employee"),
    department: user.department_name || "Unassigned",
    facility: user.facility_name || "Unassigned",
    building: user.building_name || "Unassigned",
    status: user.status,
    departmentId: user.department_id || undefined,
    facilityId: user.facility_id || undefined,
    buildingId: user.building_id || undefined,
    roleIds: user.roles.map((role) => role.id),
    employeeCode: user.employee_code || undefined,
    accountType: user.account_type,
  };
}

export function departmentFromApi(row: ApiDepartment): Department {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description || "",
  };
}

export function facilityFromApi(row: ApiFacility): Facility {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    city: [row.city, row.state].filter(Boolean).join(", "),
    address: row.address_line || "",
    people: row.employee_count,
    buildings: row.buildings.map((building, index) => ({
      id: building.id,
      name: building.name,
      people: Number(building.employeeCount || 0),
      x: numberValue(building.mapX, 8 + (index % 3) * 30),
      y: numberValue(building.mapY, 12 + Math.floor(index / 3) * 32),
      w: numberValue(building.mapWidth, 24),
      h: numberValue(building.mapHeight, 22),
    })),
  };
}

export function groupFromApi(row: ApiGroup): AudienceGroup {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description || "",
    memberIds: row.member_ids,
  };
}

export function templateFromApi(row: ApiTemplate): MessageTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.name,
    category: row.category_name || "Uncategorised",
    categoryId: row.category_id || undefined,
    severity: severity(row.alert_level),
    message: row.message_template,
    channels: channels(row.channels).filter((channel) => channel !== "sms"),
    requiresAcknowledgement: row.require_acknowledgement,
    isActive: row.is_active,
  };
}

export function alertFromApi(row: ApiAlert, tenantId: string): Broadcast {
  return {
    id: row.public_id,
    backendId: row.id,
    tenantId,
    title: row.title,
    message: row.message,
    severity: severity(row.alert_level),
    status: row.status as Broadcast["status"],
    facility: row.audience_names,
    audience: row.audience_names,
    channels: channels(row.channels),
    createdAt: timestamp(row.created_at),
    createdBy: row.created_by_name,
    recipients: row.recipients,
    sent: row.sent,
    delivered: row.delivered,
    retrying: row.retrying,
    acknowledged: row.acknowledged,
    failed: row.failed,
    requiresAcknowledgement: row.require_acknowledgement,
  };
}

export const channelForApi = (value: Channel) =>
  value === "android" ? "push" : value;
export const alertLevelForApi = (value: Severity) =>
  value === "warning"
    ? "advisory"
    : value === "info"
      ? "information"
      : "critical";

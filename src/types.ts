export type Severity = "critical" | "warning" | "info";
export type Channel = "sms" | "email" | "android";
export type AlertStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "active"
  | "resolved"
  | "cancelled"
  | "failed";

export type Tenant = {
  id: string;
  slug?: string;
  name: string;
  shortName: string;
  plan: string;
  facilities: number;
  people: number;
};

export type Facility = {
  id: string;
  tenantId: string;
  name: string;
  city: string;
  address: string;
  people: number;
  buildings: {
    id: string;
    name: string;
    people: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
};

export type Recipient = {
  id: string;
  tenantId: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  facility: string;
  building: string;
  status: "invited" | "active" | "suspended" | "disabled";
  departmentId?: string;
  facilityId?: string;
  buildingId?: string;
  roleIds?: string[];
  employeeCode?: string;
  accountType?: "admin" | "employee";
};

export type Department = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
};

export type AudienceGroup = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  memberIds: string[];
};

export type MessageTemplate = {
  id: string;
  tenantId: string;
  title: string;
  category: string;
  severity: Severity;
  message: string;
  channels: Channel[];
  requiresAcknowledgement: boolean;
  categoryId?: string;
  isActive?: boolean;
};

export type Broadcast = {
  id: string;
  backendId?: string;
  tenantId: string;
  title: string;
  message: string;
  severity: Severity;
  status: AlertStatus;
  facility: string;
  audience: string;
  channels: Channel[];
  createdAt: string;
  createdBy: string;
  recipients: number;
  sent: number;
  delivered: number;
  retrying: number;
  acknowledged: number;
  failed: number;
  requiresAcknowledgement: boolean;
  audienceType?:
    | "organisation"
    | "facility"
    | "building"
    | "department"
    | "group"
    | "person";
  audienceReferenceId?: string | null;
};

export type NavPage =
  | "overview"
  | "broadcasts"
  | "responses"
  | "people"
  | "facilities"
  | "templates"
  | "roles"
  | "settings"
  | "profile";

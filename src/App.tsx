import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Download,
  FileText,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  LockKeyhole,
  Mail,
  MapPin,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  UsersRound,
  X,
  Zap,
  Inbox,
  Eye,
  EyeOff,
  LogOut,
} from "lucide-react";
import {
  api,
  SignalOpsApiError,
  type ApiAuthContext,
  type ApiCategory,
  type ApiChannelSetting,
  type ApiAlertDelivery,
  type ApiAlertDetail,
  type ApiAuditEvent,
  type ApiPermission,
  type ApiRole,
  type ApiTenantSettings,
} from "./api";
import {
  alertFromApi,
  alertLevelForApi,
  channelForApi,
  departmentFromApi,
  facilityFromApi,
  groupFromApi,
  recipientFromApi,
  templateFromApi,
  tenantFromApi,
} from "./adapters";
import type {
  AudienceGroup,
  AlertStatus,
  Broadcast,
  Channel,
  Department,
  Facility,
  MessageTemplate,
  NavPage,
  Recipient,
  Tenant,
} from "./types";

const navItems: {
  id: NavPage;
  label: string;
  icon: typeof LayoutDashboard;
  group?: string;
  placement?: "bottom";
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "broadcasts", label: "Alerts", icon: Radio },
  { id: "responses", label: "Employee responses", icon: CheckCircle2 },
  { id: "people", label: "People & groups", icon: UsersRound },
  { id: "facilities", label: "Facilities", icon: Building2 },
  { id: "templates", label: "Templates", icon: FileText, group: "MANAGE" },
  { id: "roles", label: "Roles & approvals", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings, placement: "bottom" },
];

const pageTitles: Record<
  NavPage,
  { eyebrow: string; title: string; subtitle: string }
> = {
  overview: {
    eyebrow: "COMMAND CENTRE",
    title: "Overview",
    subtitle:
      "Monitor active incidents, delivery health and acknowledgements across your organisation.",
  },
  broadcasts: {
    eyebrow: "ALERT LIFECYCLE",
    title: "Alerts",
    subtitle:
      "Create, approve, monitor and audit every emergency alert and announcement.",
  },
  responses: {
    eyebrow: "SAFETY ACCOUNTABILITY",
    title: "Employee responses",
    subtitle:
      "Monitor acknowledgements, non-response and assistance requests during active incidents.",
  },
  people: {
    eyebrow: "DIRECTORY",
    title: "People & groups",
    subtitle: "Manage recipients and the audiences used for alerts.",
  },
  facilities: {
    eyebrow: "LOCATION INTELLIGENCE",
    title: "Facilities",
    subtitle: "See building occupancy and target alerts by location.",
  },
  templates: {
    eyebrow: "PREPAREDNESS",
    title: "Message templates",
    subtitle: "Respond quickly with reviewed, reusable emergency messages.",
  },
  roles: {
    eyebrow: "GOVERNANCE",
    title: "Roles & approvals",
    subtitle: "Control who can create, approve and release alerts.",
  },
  settings: {
    eyebrow: "ORGANISATION",
    title: "Channels & settings",
    subtitle: "Configure delivery providers and organisation-wide defaults.",
  },
  profile: {
    eyebrow: "ACCOUNT",
    title: "My profile",
    subtitle: "Review your identity, organisation access and account security.",
  },
};

const channelIcon: Record<Channel, typeof Mail> = {
  sms: MessageSquareText,
  email: Mail,
  android: Smartphone,
};
const channelLabel: Record<Channel, string> = {
  sms: "SMS",
  email: "Email",
  android: "Android push",
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const indianMobilePattern = /^\+91[6-9]\d{9}$/;
const isValidEmail = (value: string) => emailPattern.test(value.trim());
const normaliseIndianMobile = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return value.trim();
};
const isValidIndianMobile = (value: string) =>
  indianMobilePattern.test(normaliseIndianMobile(value));
const alertStatusLabel: Record<AlertStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  scheduled: "Scheduled",
  active: "Active",
  resolved: "Resolved",
  cancelled: "Cancelled",
  failed: "Failed",
};
const historicalAlertStatuses: AlertStatus[] = [
  "resolved",
  "cancelled",
  "failed",
];
const unreleasedAlertStatuses: AlertStatus[] = [
  "draft",
  "pending_approval",
  "scheduled",
];
const deliverySummary = (alert: Broadcast) => {
  if (unreleasedAlertStatuses.includes(alert.status)) return "Not released";
  if (alert.retrying)
    return `${alert.retrying} channel send${alert.retrying === 1 ? "" : "s"} retrying`;
  if (alert.failed)
    return `${alert.failed} channel send${alert.failed === 1 ? "" : "s"} permanently failed`;
  if (alert.delivered) return `${alert.delivered} confirmed delivered`;
  if (alert.sent) return `${alert.sent} accepted by provider`;
  return "No delivery activity";
};
const formatTimestamp = (value?: string | null) =>
  value ? new Date(value).toLocaleString("en-IN") : "—";
const deliveryState = (delivery: ApiAlertDelivery) =>
  delivery.status === "failed" && delivery.nextAttemptAt
    ? "retrying"
    : delivery.status;
const deliveryStateLabel = (delivery: ApiAlertDelivery) => {
  const state = deliveryState(delivery);
  if (state === "sent") return "Accepted by provider";
  if (state === "delivered") return "Confirmed delivered";
  if (state === "retrying") return "Retry scheduled";
  if (state === "failed") return "Permanently failed";
  return state.replaceAll("_", " ");
};

type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active";
  isPlatformAdmin: boolean;
  permissions: string[];
};

const currentUserFromSession = (session: ApiAuthContext): CurrentUser => ({
  id: session.id,
  name: session.full_name,
  email: session.email,
  role: session.role,
  status: session.status,
  isPlatformAdmin: session.is_platform_admin,
  permissions: session.permissions,
});

const roleLabel = (user: CurrentUser) => {
  if (user.isPlatformAdmin) return "Platform administrator";
  if (user.role === "owner") return "Organisation owner";
  if (user.role === "admin") return "Organisation administrator";
  return user.role
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

function App() {
  const accountFlow = window.location.pathname.endsWith("/activate")
    ? "activate"
    : window.location.pathname.endsWith("/forgot-password") ||
        window.location.pathname.endsWith("/reset-password")
      ? "forgot"
      : null;
  const [authenticated, setAuthenticated] = useState(false);
  const permissionsRef = useRef<string[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser>({
    id: "",
    name: "",
    email: "",
    role: "",
    status: "active",
    isPlatformAdmin: false,
    permissions: [],
  });
  const [page, setPage] = useState<NavPage>(() => {
    const requested = window.location.hash.replace("#", "") as NavPage;
    return navItems.some((item) => item.id === requested) ||
      requested === "profile"
      ? requested
      : "overview";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("signalops.sidebar") !== "expanded",
  );
  const [tenant, setTenant] = useState<Tenant>({
    id: "",
    slug: "",
    name: "",
    shortName: "",
    plan: "",
    facilities: 0,
    people: 0,
  });
  const [headerPanel, setHeaderPanel] = useState<
    "search" | "notifications" | null
  >(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPreset, setComposerPreset] = useState<MessageTemplate | null>(
    null,
  );
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [addDepartmentOpen, setAddDepartmentOpen] = useState(false);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [facilityEditorOpen, setFacilityEditorOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [groups, setGroups] = useState<AudienceGroup[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>(
    [],
  );
  const [facilityRecords, setFacilityRecords] = useState<Facility[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [roles, setRoles] = useState<ApiRole[]>([]);
  const [channelSettings, setChannelSettings] = useState<ApiChannelSetting[]>(
    [],
  );
  const templateCategories = categories.map((category) => category.name);
  const setTemplateCategories = (names: string[]) =>
    setCategories(
      names.map(
        (name) =>
          categories.find((category) => category.name === name) ?? {
            id: "",
            tenant_id: tenant.id,
            name,
            is_active: true,
          },
      ),
    );

  const errorMessage = (error: unknown) =>
    error instanceof SignalOpsApiError
      ? error.message
      : "The request could not be completed";
  const loadWorkspace = useCallback(async () => {
    setLoadingData(true);
    try {
      const granted = permissionsRef.current;
      const allowed = (...required: string[]) =>
        granted.includes("*") ||
        required.some((permission) => granted.includes(permission));
      const [
        workspace,
        users,
        departmentRows,
        facilityRows,
        groupRows,
        categoryRows,
        templateRows,
        alertRows,
        roleRows,
        settingsData,
      ] = await Promise.all([
        api.workspace(),
        allowed("users.read") ? api.users() : Promise.resolve([]),
        allowed("users.read", "directory.manage")
          ? api.departments()
          : Promise.resolve([]),
        allowed("workspace.read", "directory.manage")
          ? api.facilities()
          : Promise.resolve([]),
        allowed("users.read", "directory.manage")
          ? api.groups()
          : Promise.resolve([]),
        allowed("workspace.read", "templates.manage")
          ? api.categories()
          : Promise.resolve([]),
        allowed("workspace.read", "templates.manage")
          ? api.templates()
          : Promise.resolve([]),
        allowed("alerts.read") ? api.alerts() : Promise.resolve([]),
        allowed("users.read", "roles.manage")
          ? api.roles()
          : Promise.resolve([]),
        allowed("workspace.read")
          ? api.settings()
          : Promise.resolve({
              preferences: null as unknown as ApiTenantSettings,
              channels: [] as ApiChannelSetting[],
            }),
      ]);
      const nextTenant = tenantFromApi(workspace);
      setTenant(nextTenant);
      setRecipients(users.map((user) => recipientFromApi(user, nextTenant.id)));
      setDepartments(departmentRows.map(departmentFromApi));
      setFacilityRecords(facilityRows.map(facilityFromApi));
      setGroups(groupRows.map(groupFromApi));
      setCategories(categoryRows);
      setMessageTemplates(
        templateRows
          .filter((template) => template.is_active)
          .map(templateFromApi),
      );
      setBroadcasts(
        alertRows.map((alert) => alertFromApi(alert, nextTenant.id)),
      );
      setRoles(roleRows);
      setChannelSettings(settingsData.channels);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (accountFlow) {
      setBootstrapping(false);
      return;
    }
    let active = true;
    api
      .restore()
      .then(async (session) => {
        if (!active) return;
        if (session) {
          permissionsRef.current = session.is_platform_admin
            ? ["*"]
            : session.permissions;
          setCurrentUser(currentUserFromSession(session));
          setAuthenticated(true);
          try {
            await loadWorkspace();
          } catch {
            setAuthenticated(false);
          }
        }
      })
      .finally(() => {
        if (active) setBootstrapping(false);
      });
    return () => {
      active = false;
    };
  }, [accountFlow, loadWorkspace]);
  useEffect(
    () =>
      localStorage.setItem(
        "signalops.sidebar",
        sidebarCollapsed ? "collapsed" : "expanded",
      ),
    [sidebarCollapsed],
  );
  useEffect(() => {
    const syncPageFromUrl = () => {
      const requested = window.location.hash.replace("#", "") as NavPage;
      if (
        navItems.some((item) => item.id === requested) ||
        requested === "profile"
      ) {
        setPage(requested);
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    };
    window.addEventListener("hashchange", syncPageFromUrl);
    return () => window.removeEventListener("hashchange", syncPageFromUrl);
  }, []);
  useEffect(() => {
    const hasOverlay =
      composerOpen ||
      addPersonOpen ||
      addDepartmentOpen ||
      templateEditorOpen ||
      facilityEditorOpen;
    document.body.style.overflow = hasOverlay ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [
    composerOpen,
    addPersonOpen,
    addDepartmentOpen,
    templateEditorOpen,
    facilityEditorOpen,
  ]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setHeaderPanel("search");
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  const tenantId = tenant.id;
  const hasPermission = useCallback(
    (...required: string[]) =>
      currentUser.isPlatformAdmin ||
      currentUser.permissions.includes("*") ||
      required.some((permission) =>
        currentUser.permissions.includes(permission),
      ),
    [currentUser.isPlatformAdmin, currentUser.permissions],
  );
  const canViewPage = useCallback((target: NavPage) => {
    if (target === "profile") return true;
    if (target === "broadcasts" || target === "responses")
      return hasPermission("alerts.read");
    if (target === "people")
      return hasPermission("users.read", "directory.manage");
    if (target === "roles")
      return hasPermission("users.read", "roles.manage");
    if (target === "templates")
      return hasPermission("workspace.read", "templates.manage");
    if (target === "facilities")
      return hasPermission("workspace.read", "directory.manage");
    return hasPermission("workspace.read");
  }, [hasPermission]);
  useEffect(() => {
    if (!authenticated || canViewPage(page)) return;
    const fallback = navItems.find((item) => canViewPage(item.id))?.id ?? "profile";
    setPage(fallback);
    window.location.hash = fallback;
  }, [authenticated, canViewPage, page]);
  const tenantBroadcasts = broadcasts.filter(
    (item) => item.tenantId === tenantId,
  );
  const tenantRecipients = recipients.filter(
    (item) => item.tenantId === tenantId && item.accountType === "employee",
  );
  const activeBroadcasts = tenantBroadcasts.filter(
    (item) => item.status === "active",
  );
  const deliveryTotal = tenantBroadcasts.reduce(
    (sum, item) => sum + item.sent + item.failed,
    0,
  );
  const acceptedTotal = tenantBroadcasts.reduce(
    (sum, item) => sum + item.sent,
    0,
  );
  const deliveryRate = deliveryTotal
    ? Math.round((acceptedTotal / deliveryTotal) * 1000) / 10
    : null;
  const criticalAttention = activeBroadcasts.filter(
    (item) => item.severity === "critical",
  );
  const failedDeliveries = tenantBroadcasts.reduce(
    (total, item) => total + item.failed,
    0,
  );
  const notificationCount =
    criticalAttention.length + (failedDeliveries ? 1 : 0);
  const selectedBroadcast =
    broadcasts.find((item) => item.id === detailId) ?? null;
  const meta = pageTitles[page];
  const now = new Date();
  const indiaHour = Number(
    new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Kolkata",
    }).format(now),
  );
  const greeting =
    indiaHour < 12
      ? "Good morning"
      : indiaHour < 17
        ? "Good afternoon"
        : "Good evening";
  const todayLabel = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  })
    .format(now)
    .toUpperCase();
  const openComposer = (preset?: MessageTemplate) => {
    if (!hasPermission("alerts.create")) {
      setToast("You do not have permission to create alerts");
      return;
    }
    setComposerPreset(preset ?? null);
    setComposerOpen(true);
  };

  const navigate = (nextPage: NavPage) => {
    setPage(nextPage);
    if (window.location.hash !== `#${nextPage}`)
      window.location.hash = nextPage;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setMobileNav(false);
    setHeaderPanel(null);
  };

  const createBroadcast = async (
    draft: Omit<
      Broadcast,
      | "id"
      | "tenantId"
      | "createdAt"
      | "createdBy"
      | "sent"
      | "delivered"
      | "retrying"
      | "acknowledged"
      | "failed"
    >,
  ) => {
    try {
      const created = await api.createAlert({
        templateId: composerPreset?.id || null,
        categoryName: composerPreset?.category,
        alertLevel: alertLevelForApi(draft.severity),
        title: draft.title,
        message: draft.message,
        requireAcknowledgement: draft.requiresAcknowledgement,
        channels: draft.channels.map(channelForApi),
        audiences: [
          {
            type: draft.audienceType || "organisation",
            referenceId: draft.audienceReferenceId || null,
            displayName: draft.audience,
          },
        ],
        release:
          draft.status === "draft"
            ? "draft"
            : draft.status === "pending_approval"
              ? "approval"
              : "immediate",
      });
      await loadWorkspace();
      setComposerOpen(false);
      setDetailId(created.public_id);
      navigate("broadcasts");
      setToast(
        created.status === "failed"
          ? "Alert created, but no selected delivery channel was eligible"
          : draft.status === "draft"
          ? "Alert saved as a draft"
          : draft.status === "pending_approval"
            ? "Alert submitted for approval"
            : "Alert sent successfully",
      );
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const runAlertAction = async (
    id: string,
    action: (backendId: string) => Promise<unknown>,
    successMessage: string,
  ) => {
    const alert = broadcasts.find((item) => item.id === id);
    if (!alert?.backendId) return;
    try {
      const outcome = await action(alert.backendId);
      await loadWorkspace();
      setToast(
        outcome &&
          typeof outcome === "object" &&
          "status" in outcome &&
          outcome.status === "failed"
          ? "Alert could not be delivered through any selected channel"
          : successMessage,
      );
    } catch (error) {
      setToast(errorMessage(error));
      throw error;
    }
  };

  const addRecipient = async (person: Recipient) => {
    try {
      await api.createUser({
        accountType: "employee",
        fullName: person.name,
        email: person.email,
        phone: person.phone || undefined,
        employeeCode: person.employeeCode,
        jobTitle: person.role,
        departmentId: person.departmentId,
        facilityId: person.facilityId,
        buildingId: person.buildingId,
        roleIds: person.roleIds || [],
      });
      await loadWorkspace();
      setAddPersonOpen(false);
      setToast(`Invitation sent to ${person.name}`);
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const addDepartment = async (department: Department) => {
    try {
      await api.createDepartment({
        name: department.name,
        description: department.description,
      });
      await loadWorkspace();
      setAddDepartmentOpen(false);
      setToast(`${department.name} department added`);
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const saveTemplate = async (template: MessageTemplate) => {
    try {
      let categoryId = categories.find(
        (item) => item.name === template.category,
      )?.id;
      if (!categoryId)
        categoryId = (
          await api.createCategory({ name: template.category, isActive: true })
        ).id;
      await api.createTemplate({
        categoryId,
        name: template.title,
        alertLevel: alertLevelForApi(template.severity),
        titleTemplate: template.title,
        messageTemplate: template.message,
        requireAcknowledgement: template.requiresAcknowledgement,
        isActive: true,
        channels: template.channels.map(channelForApi),
      });
      await loadWorkspace();
      setTemplateEditorOpen(false);
      setToast(`${template.title} template created`);
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const syncRecipients = async (next: Recipient[]) => {
    try {
      const removed = recipients.find(
        (person) => !next.some((candidate) => candidate.id === person.id),
      );
      if (removed) await api.updateUser(removed.id, { status: "disabled" });
      const changed = next.find((person) => {
        const current = recipients.find(
          (candidate) => candidate.id === person.id,
        );
        return current && JSON.stringify(current) !== JSON.stringify(person);
      });
      if (changed) {
        const selectedFacility = facilityRecords.find(
          (facility) => facility.name === changed.facility,
        );
        await api.updateUser(changed.id, {
          fullName: changed.name,
          email: changed.email,
          phone: changed.phone,
          jobTitle: changed.role,
          employeeCode: changed.employeeCode,
          departmentId: departments.find(
            (department) => department.name === changed.department,
          )?.id,
          facilityId: selectedFacility?.id,
          buildingId: selectedFacility?.buildings.find(
            (building) => building.name === changed.building,
          )?.id,
          roleIds: changed.roleIds || [],
          status: changed.status,
        });
      }
      await loadWorkspace();
      setToast(removed ? `${removed.name} disabled` : "Employee updated");
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const syncDepartments = async (next: Department[]) => {
    try {
      const created = next.find(
        (item) => !departments.some((current) => current.id === item.id),
      );
      const removed = departments.find(
        (item) => !next.some((current) => current.id === item.id),
      );
      const changed = next.find((item) => {
        const current = departments.find(
          (candidate) => candidate.id === item.id,
        );
        return (
          current &&
          (current.name !== item.name ||
            current.description !== item.description)
        );
      });
      if (created)
        await api.createDepartment({
          name: created.name,
          description: created.description,
        });
      else if (removed) await api.deleteDepartment(removed.id);
      else if (changed)
        await api.updateDepartment(changed.id, {
          name: changed.name,
          description: changed.description,
        });
      await loadWorkspace();
      setToast("Departments updated");
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const syncGroups = async (next: AudienceGroup[]) => {
    try {
      const created = next.find(
        (item) => !groups.some((current) => current.id === item.id),
      );
      const removed = groups.find(
        (item) => !next.some((current) => current.id === item.id),
      );
      const changed = next.find((item) => {
        const current = groups.find((candidate) => candidate.id === item.id);
        return current && JSON.stringify(current) !== JSON.stringify(item);
      });
      if (created)
        await api.createGroup({
          name: created.name,
          description: created.description,
          memberIds: created.memberIds,
        });
      else if (removed) await api.deleteGroup(removed.id);
      else if (changed)
        await api.updateGroup(changed.id, {
          name: changed.name,
          description: changed.description,
          memberIds: changed.memberIds,
        });
      await loadWorkspace();
      setToast("Audience groups updated");
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const facilityPayload = (facility: Facility) => {
    const [city, ...stateParts] = facility.city.split(",");
    return {
      name: facility.name,
      addressLine: facility.address,
      city: city.trim(),
      state: stateParts.join(",").trim(),
      countryCode: "IN",
      buildings: facility.buildings.map((building) => ({
        name: building.name,
        mapX: building.x,
        mapY: building.y,
        mapWidth: building.w,
        mapHeight: building.h,
      })),
    };
  };

  const syncFacilities = async (next: Facility[]) => {
    try {
      const created = next.find(
        (item) => !facilityRecords.some((current) => current.id === item.id),
      );
      const removed = facilityRecords.find(
        (item) => !next.some((current) => current.id === item.id),
      );
      const changed = next.find((item) => {
        const current = facilityRecords.find(
          (candidate) => candidate.id === item.id,
        );
        return current && JSON.stringify(current) !== JSON.stringify(item);
      });
      if (created) await api.createFacility(facilityPayload(created));
      else if (removed) await api.deleteFacility(removed.id);
      else if (changed) {
        const before = facilityRecords.find((item) => item.id === changed.id)!;
        const payload = facilityPayload(changed);
        await api.updateFacility(changed.id, {
          name: payload.name,
          addressLine: payload.addressLine,
          city: payload.city,
          state: payload.state,
        });
        for (const building of changed.buildings) {
          const buildingPayload = {
            name: building.name,
            mapX: building.x,
            mapY: building.y,
            mapWidth: building.w,
            mapHeight: building.h,
          };
          if (before.buildings.some((item) => item.id === building.id))
            await api.updateBuilding(building.id, buildingPayload);
          else await api.createBuilding(changed.id, buildingPayload);
        }
        for (const building of before.buildings.filter(
          (item) =>
            !changed.buildings.some((candidate) => candidate.id === item.id),
        ))
          await api.deleteBuilding(building.id);
      }
      await loadWorkspace();
      setToast("Facilities updated");
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const syncTemplates = async (next: MessageTemplate[]) => {
    try {
      const removed = messageTemplates.find(
        (item) => !next.some((candidate) => candidate.id === item.id),
      );
      const changed = next.find((item) => {
        const current = messageTemplates.find(
          (candidate) => candidate.id === item.id,
        );
        return current && JSON.stringify(current) !== JSON.stringify(item);
      });
      if (removed) await api.deleteTemplate(removed.id);
      else if (changed) {
        let categoryId = categories.find(
          (item) => item.name === changed.category,
        )?.id;
        if (!categoryId)
          categoryId = (
            await api.createCategory({ name: changed.category, isActive: true })
          ).id;
        await api.updateTemplate(changed.id, {
          categoryId,
          name: changed.title,
          alertLevel: alertLevelForApi(changed.severity),
          titleTemplate: changed.title,
          messageTemplate: changed.message,
          requireAcknowledgement: changed.requiresAcknowledgement,
          isActive: true,
          channels: changed.channels.map(channelForApi),
        });
      }
      await loadWorkspace();
      setToast(removed ? "Template archived" : "Template updated");
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const login = async (email: string, password: string, remember: boolean) => {
    const context = await api.login(email, password, remember);
    permissionsRef.current = context.user.permissions;
    setCurrentUser({
      id: context.user.id,
      name: context.user.fullName,
      email: context.user.email,
      role: context.user.roles[0]?.name || "Organisation administrator",
      status: "active",
      isPlatformAdmin: false,
      permissions: context.user.permissions,
    });
    await loadWorkspace();
    setAuthenticated(true);
  };

  if (accountFlow === "forgot") return <PasswordRecoveryPage />;
  if (accountFlow === "activate") return <AccountPasswordPage />;
  if (bootstrapping)
    return (
      <main className="login-page">
        <div className="loading-state">Loading SignalOps…</div>
      </main>
    );
  if (!authenticated) return <AdminLogin onLogin={login} />;

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Radio size={22} />
          </div>
          <div>
            <strong>SignalOps</strong>
            <span>Emergency communication</span>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={
            sidebarCollapsed ? "Expand navigation" : "Collapse navigation"
          }
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {sidebarCollapsed ? (
            <ChevronRight size={15} strokeWidth={1.8} />
          ) : (
            <ChevronLeft size={15} strokeWidth={1.8} />
          )}
        </button>
        <nav className="nav-list">
          {navItems
            .filter(
              (item) => item.placement !== "bottom" && canViewPage(item.id),
            )
            .map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  {item.group && <div className="nav-group">{item.group}</div>}
                  <button
                    title={sidebarCollapsed ? item.label : undefined}
                    aria-label={item.label}
                    aria-current={page === item.id ? "page" : undefined}
                    className={`nav-item ${page === item.id ? "active" : ""}`}
                    onClick={() => navigate(item.id)}
                  >
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{item.label}</span>
                    {item.id === "broadcasts" &&
                      activeBroadcasts.length > 0 && (
                        <b>{activeBroadcasts.length}</b>
                      )}
                  </button>
                  {index === 4 && <div className="nav-separator" />}
                </div>
              );
            })}
        </nav>
        <div className="sidebar-bottom">
          {canViewPage("settings") && (
            <button
              title={sidebarCollapsed ? "Settings" : undefined}
              aria-current={page === "settings" ? "page" : undefined}
              className={`nav-item ${page === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Settings size={18} strokeWidth={1.8} />
              <span>Settings</span>
            </button>
          )}
          <button
            title={sidebarCollapsed ? "Help & support" : undefined}
            className="nav-item"
            onClick={() => {
              window.location.href =
                "mailto:support@signalops.in?subject=SignalOps support";
            }}
          >
            <LifeBuoy size={18} strokeWidth={1.8} />
            <span>Help & support</span>
          </button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileNav((value) => !value)}
          >
            <Menu size={20} />
          </button>
          <button
            className={`global-search ${headerPanel === "search" ? "active" : ""}`}
            onClick={() => {
              setHeaderPanel((value) =>
                value === "search" ? null : "search",
              );
            }}
          >
            <Search size={17} />
            <span>Search alerts, people or facilities...</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="profile-entry">
            <button
              className={`profile-trigger ${page === "profile" ? "active" : ""}`}
              aria-label="Open my profile"
              aria-current={page === "profile" ? "page" : undefined}
              onClick={() => navigate("profile")}
            >
              <span className="profile-avatar">
                {currentUser.name
                  .split(/\s+/)
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <span className="profile-copy">
                <b>{currentUser.name}</b>
                <small>{roleLabel(currentUser)}</small>
              </span>
            </button>
          </div>
          <button
            className="top-signout"
            title="Log out"
            aria-label="Log out"
            onClick={async () => {
              await api.logout();
              setAuthenticated(false);
            }}
          >
            <LogOut size={18} strokeWidth={1.8} />
          </button>
          <div className="top-actions">
            <button
              title="Search"
              aria-label="Search"
              className={`icon-button ${headerPanel === "search" ? "active" : ""}`}
              onClick={() => {
                setHeaderPanel((value) =>
                  value === "search" ? null : "search",
                );
              }}
            >
              <Search size={19} />
            </button>
            <button
              title="Notifications"
              aria-label="Notifications"
              className={`icon-button notification-button ${headerPanel === "notifications" ? "active" : ""}`}
              onClick={() => {
                setHeaderPanel((value) =>
                  value === "notifications" ? null : "notifications",
                );
              }}
            >
              <BellRing size={19} />
              {notificationCount > 0 && <i />}
            </button>
            {hasPermission("alerts.create") && (
              <button className="primary-button" onClick={() => openComposer()}>
                <Plus size={18} />
                Create alert
              </button>
            )}
            {headerPanel === "search" && (
              <div className="header-popover search-popover">
                <span className="popover-label">SEARCH SIGNALOPS</span>
                <div className="popover-search">
                  <Search size={17} />
                  <input
                    autoFocus
                    placeholder="Search alerts, people or facilities"
                  />
                </div>
                <div className="popover-section">
                  <span>QUICK LINKS</span>
                  <button
                    onClick={() => {
                      navigate("broadcasts");
                      setHeaderPanel(null);
                    }}
                  >
                    <Radio size={17} />
                    <span>
                      <b>Alerts</b>
                      <small>Active, pending and resolved alerts</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                  <button
                    onClick={() => {
                      navigate("people");
                      setHeaderPanel(null);
                    }}
                  >
                    <Users size={17} />
                    <span>
                      <b>People & groups</b>
                      <small>Recipient directory and audiences</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                  <button
                    onClick={() => {
                      navigate("facilities");
                      setHeaderPanel(null);
                    }}
                  >
                    <Building2 size={17} />
                    <span>
                      <b>Facilities</b>
                      <small>Buildings and location targeting</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
            {headerPanel === "notifications" && (
              <div className="header-popover notification-popover">
                <div className="popover-head">
                  <div>
                    <span className="popover-label">NOTIFICATIONS</span>
                    <h3>Attention needed</h3>
                  </div>
                  <span className="count-chip">{notificationCount}</span>
                </div>
                {criticalAttention.slice(0, 2).map((alert) => (
                  <button
                    className="notification-item"
                    key={alert.id}
                    onClick={() => {
                      setDetailId(alert.id);
                      navigate("broadcasts");
                      setHeaderPanel(null);
                    }}
                  >
                    <span className="severity-icon critical">
                      <AlertTriangle size={17} />
                    </span>
                    <span>
                      <b>{alert.title}</b>
                      <small>
                        {Math.max(0, alert.recipients - alert.acknowledged)}{" "}
                        people awaiting acknowledgement
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                {failedDeliveries > 0 && (
                  <button
                    className="notification-item"
                    onClick={() => {
                      navigate("broadcasts");
                      setHeaderPanel(null);
                    }}
                  >
                    <span className="severity-icon warning">
                      <MessageSquareText size={17} />
                    </span>
                    <span>
                      <b>{failedDeliveries} deliveries failed</b>
                      <small>Review alert delivery activity</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                )}
                {!notificationCount && (
                  <div className="info-note">
                    <CheckCircle2 size={17} />
                    <span>No operational issues need attention.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="content" aria-busy={loadingData}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "overview" ? todayLabel : meta.eyebrow}
              </span>
              <h1>
                {page === "overview"
                  ? `${greeting}, ${currentUser.name.split(" ")[0]}`
                  : meta.title}
              </h1>
              <p>{meta.subtitle}</p>
            </div>
            {page === "overview" && hasPermission("alerts.create") && (
              <div className="page-actions">
                <button
                  className="primary-button"
                  onClick={() => openComposer()}
                >
                  <Plus size={16} />
                  Create alert
                </button>
              </div>
            )}
            {page === "people" && (
              <div className="page-actions">
                {hasPermission("directory.manage") && (
                  <button
                    className="secondary-button"
                    onClick={() => setAddDepartmentOpen(true)}
                  >
                    <Plus size={17} />
                    Add department
                  </button>
                )}
                {hasPermission("users.manage") && (
                  <button
                    className="primary-button"
                    onClick={() => setAddPersonOpen(true)}
                  >
                    <Plus size={17} />
                    Add person
                  </button>
                )}
              </div>
            )}
            {page !== "overview" &&
              page !== "settings" &&
              page !== "people" &&
              page !== "roles" &&
              page !== "responses" &&
              page !== "profile" &&
              (page !== "broadcasts" || hasPermission("alerts.create")) &&
              (page !== "templates" || hasPermission("templates.manage")) &&
              (page !== "facilities" || hasPermission("directory.manage")) && (
                <PageAction
                  page={page}
                  onAction={() => {
                    if (page === "broadcasts") openComposer();
                    else if (page === "templates") setTemplateEditorOpen(true);
                    else if (page === "facilities") setFacilityEditorOpen(true);
                    else
                      setToast(
                        "Role assignments can be managed from the role menu below.",
                      );
                  }}
                />
              )}
          </div>

          {page === "overview" && (
            <Overview
              broadcasts={tenantBroadcasts}
              active={activeBroadcasts}
              recipients={tenant.people}
              facilitiesCount={tenant.facilities}
              deliveryRate={deliveryRate}
              templates={messageTemplates.filter(
                (item) => item.tenantId === tenantId,
              )}
              facilities={facilityRecords.filter(
                (item) => item.tenantId === tenantId,
              )}
              channelSettings={channelSettings}
              canCreateAlerts={hasPermission("alerts.create")}
              onCreate={openComposer}
              onViewAll={() => {
                setDetailId(null);
                navigate("broadcasts");
              }}
              onOpenAlert={(id) => {
                setDetailId(id);
                navigate("broadcasts");
              }}
            />
          )}
          {page === "broadcasts" && (
            <BroadcastsPage
              broadcasts={tenantBroadcasts}
              selected={
                selectedBroadcast?.tenantId === tenantId
                  ? selectedBroadcast
                  : null
              }
              onSelect={setDetailId}
              onClose={() => setDetailId(null)}
              onNotify={setToast}
              currentUserId={currentUser.id}
              permissions={currentUser.permissions}
              isPlatformAdmin={currentUser.isPlatformAdmin}
              onSubmit={(id) =>
                runAlertAction(id, api.submitAlert, "Alert submitted for approval")
              }
              onEdit={(id, message) =>
                runAlertAction(
                  id,
                  (backendId) => api.updateAlert(backendId, { message }),
                  "Draft message updated",
                )
              }
              onApprove={(id) =>
                runAlertAction(
                  id,
                  api.approveAlert,
                  "Alert approved and released to recipients",
                )
              }
              onReturn={(id, note) =>
                runAlertAction(
                  id,
                  (backendId) => api.returnAlert(backendId, note),
                  "Alert returned to its creator for changes",
                )
              }
              onRelease={(id) =>
                runAlertAction(id, api.releaseAlert, "Alert released to recipients")
              }
              onResolve={(id) =>
                runAlertAction(id, api.resolveAlert, "Incident marked as resolved")
              }
              onCancel={(id) =>
                runAlertAction(id, api.cancelAlert, "Alert cancelled")
              }
            />
          )}
          {page === "responses" && (
            <ResponsesPage
              broadcasts={tenantBroadcasts}
              recipients={tenantRecipients}
              canManageResponses={hasPermission("responses.manage")}
              canReadAudit={hasPermission("audit.read")}
              onNotify={setToast}
            />
          )}
          {page === "people" && (
            <PeoplePage
              recipients={tenantRecipients}
              departments={departments.filter(
                (item) => item.tenantId === tenantId,
              )}
              groups={groups.filter((item) => item.tenantId === tenantId)}
              facilities={facilityRecords.filter(
                (item) => item.tenantId === tenantId,
              )}
              canManageUsers={hasPermission("users.manage")}
              canManageDirectory={hasPermission("directory.manage")}
              onRecipientsChange={syncRecipients}
              onDepartmentsChange={syncDepartments}
              onGroupsChange={syncGroups}
              onResendInvitation={async (id) => {
                try {
                  await api.resendInvitation(id);
                  setToast("Invitation email sent");
                } catch (error) {
                  setToast(errorMessage(error));
                }
              }}
              onNotify={setToast}
            />
          )}
          {page === "facilities" && (
            <FacilitiesPage
              tenantId={tenantId}
              facilities={facilityRecords}
              canManage={hasPermission("directory.manage")}
              onChange={syncFacilities}
            />
          )}
          {page === "templates" && (
            <TemplatesPage
              templates={messageTemplates.filter(
                (item) => item.tenantId === tenantId,
              )}
              categories={templateCategories}
              canManage={hasPermission("templates.manage")}
              canCreateAlerts={hasPermission("alerts.create")}
              onCategoriesChange={setTemplateCategories}
              onUse={openComposer}
              onChange={syncTemplates}
            />
          )}
          {page === "roles" && (
            <RolesPage
              roles={roles}
              portalUsers={recipients.filter(
                (person) => person.accountType === "admin",
              )}
              canManageRoles={hasPermission("roles.manage")}
              canManageUsers={hasPermission("users.manage")}
              canManageWorkspace={hasPermission("workspace.manage")}
              onReload={loadWorkspace}
              onNotify={setToast}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              canManage={hasPermission("workspace.manage")}
              onNotify={setToast}
            />
          )}
          {page === "profile" && (
            <ProfilePage
              user={currentUser}
              organisation={tenant.name}
              onChangePassword={() => {
                window.location.href = `/forgot-password?email=${encodeURIComponent(currentUser.email)}`;
              }}
            />
          )}
        </main>
      </div>

      {composerOpen && (
        <AlertComposer
          tenantId={tenantId}
          facilities={facilityRecords}
          recipients={tenantRecipients}
          groups={groups.filter((item) => item.tenantId === tenantId)}
          templates={messageTemplates.filter(
            (item) => item.tenantId === tenantId,
          )}
          preset={composerPreset}
          canSendImmediately={hasPermission("alerts.send")}
          onClose={() => setComposerOpen(false)}
          onCreate={createBroadcast}
        />
      )}
      {addPersonOpen && (
        <AddPersonModal
          tenantId={tenantId}
          facilities={facilityRecords}
          departments={departments.filter((item) => item.tenantId === tenantId)}
          roles={roles.filter((role) => role.audience === "employee")}
          onClose={() => setAddPersonOpen(false)}
          onAdd={addRecipient}
        />
      )}
      {addDepartmentOpen && (
        <AddDepartmentModal
          tenantId={tenantId}
          onClose={() => setAddDepartmentOpen(false)}
          onAdd={addDepartment}
        />
      )}
      {templateEditorOpen && (
        <TemplateEditorModal
          tenantId={tenantId}
          categories={templateCategories}
          onCategoriesChange={setTemplateCategories}
          onClose={() => setTemplateEditorOpen(false)}
          onSave={saveTemplate}
        />
      )}
      {facilityEditorOpen && (
        <FacilityEditorModal
          tenantId={tenantId}
          onClose={() => setFacilityEditorOpen(false)}
          onSave={async (facility) => {
            await syncFacilities([...facilityRecords, facility]);
            setFacilityEditorOpen(false);
          }}
        />
      )}
      {headerPanel && (
        <button
          className="popover-dismiss"
          aria-label="Close open menu"
          onClick={() => {
            setHeaderPanel(null);
          }}
        />
      )}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={20} />
          <span>{toast}</span>
          <button onClick={() => setToast("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {mobileNav && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
    </div>
  );
}

function AdminLogin({
  onLogin,
}: {
  onLogin: (
    email: string,
    password: string,
    remember: boolean,
  ) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidEmail(email) || password.length < 8) {
      setError("Enter a valid administrator email and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onLogin(email.trim().toLowerCase(), password, remember);
    } catch (problem) {
      setError(
        problem instanceof SignalOpsApiError
          ? problem.message
          : "An unexpected error occurred while loading the organisation. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-form-section">
          <h1>Welcome back</h1>
          <p>Sign in to your organisation administrator account</p>
          <form onSubmit={submit}>
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              className="login-input"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
            <label htmlFor="admin-password">Password</label>
            <div className="login-password">
              <input
                id="admin-password"
                className="login-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <div className="login-options">
              <label>
                <span
                  className={`login-checkbox ${remember ? "checked" : ""}`}
                  onClick={() => setRemember((value) => !value)}
                >
                  {remember && <Check size={13} />}
                </span>
                Remember me
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const query = email.trim()
                    ? `?email=${encodeURIComponent(email.trim())}`
                    : "";
                  window.location.href = `/forgot-password${query}`;
                }}
              >
                Forgot password?
              </button>
            </div>
            {error && <div className="login-error">{error}</div>}
            <button className="login-submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in to admin portal"}
            </button>
          </form>
        </div>
        <aside
          className="login-visual"
          aria-label="SignalOps administrator access"
        >
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
          <div className="blob blob-4" />
          <div className="blob blob-5" />
          <img
            className="astronaut-image"
            src="/images/astro.png"
            alt="Astronaut floating in space"
          />
        </aside>
      </section>
    </main>
  );
}

function PageAction({
  page,
  onAction,
}: {
  page: NavPage;
  onAction: () => void;
}) {
  const labels: Partial<Record<NavPage, string>> = {
    facilities: "Add facility",
    roles: "Invite administrator",
    templates: "Create template",
    people: "Add person",
    broadcasts: "Create alert",
  };
  return (
    <button
      className={page === "broadcasts" ? "primary-button" : "secondary-button"}
      onClick={onAction}
    >
      <Plus size={17} />
      {labels[page] ?? "Add"}
    </button>
  );
}

function Overview({
  broadcasts,
  active,
  recipients,
  facilitiesCount,
  deliveryRate,
  templates,
  facilities,
  channelSettings,
  canCreateAlerts,
  onCreate,
  onViewAll,
  onOpenAlert,
}: {
  broadcasts: Broadcast[];
  active: Broadcast[];
  recipients: number;
  facilitiesCount: number;
  deliveryRate: number | null;
  templates: MessageTemplate[];
  facilities: Facility[];
  channelSettings: ApiChannelSetting[];
  canCreateAlerts: boolean;
  onCreate: (preset?: MessageTemplate) => void;
  onViewAll: () => void;
  onOpenAlert: (id: string) => void;
}) {
  const critical = active.find((item) => item.severity === "critical");
  return (
    <>
      {critical && (
        <section className="incident-banner">
          <div className="pulse-icon">
            <AlertTriangle size={23} />
          </div>
          <div className="incident-copy">
            <span>ACTIVE CRITICAL INCIDENT</span>
            <h2>{critical.title}</h2>
            <p>
              {critical.facility} · Started{" "}
              {critical.createdAt.replace("Today, ", "")}
            </p>
          </div>
          <div className="ack-summary">
            <span>
              <b>{critical.acknowledged}</b> / {critical.recipients}
            </span>
            <small>People safe</small>
            <div className="progress">
              <i
                style={{
                  width: `${critical.recipients ? (critical.acknowledged / critical.recipients) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <button
            className="light-button"
            onClick={() => onOpenAlert(critical.id)}
          >
            Open incident <ChevronRight size={17} />
          </button>
        </section>
      )}

      <section className="stat-grid">
        <StatCard
          icon={Radio}
          label="Active alerts"
          value={active.length}
          helper={
            active.some((item) => item.severity === "critical")
              ? `${active.filter((item) => item.severity === "critical").length} need attention`
              : "All under control"
          }
          tone="red"
        />
        <StatCard
          icon={Users}
          label="Employees"
          value={recipients.toLocaleString("en-IN")}
          helper="Registered in this organisation"
          tone="blue"
        />
        <StatCard
          icon={Building2}
          label="Facilities"
          value={facilitiesCount}
          helper="Configured locations"
          tone="purple"
        />
        <StatCard
          icon={Gauge}
          label="Provider acceptance"
          value={deliveryRate === null ? "—" : `${deliveryRate}%`}
          helper={
            deliveryRate === null
              ? "No completed channel sends"
              : "Completed channel sends"
          }
          tone="green"
        />
      </section>

      <section className="dashboard-grid">
        <div className="panel broadcast-panel">
          <PanelHeader
            title="Recent alerts"
            subtitle="Delivery and acknowledgement status across every channel"
            action={
              <button onClick={onViewAll}>
                View all alerts <ChevronRight size={15} />
              </button>
            }
          />
          <div className="broadcast-list">
            {broadcasts.slice(0, 4).map((item) => (
              <BroadcastRow
                key={item.id}
                item={item}
                onClick={() => onOpenAlert(item.id)}
              />
            ))}
            {!broadcasts.length && (
              <EmptyState
                title="No alerts yet"
                text="Create the first alert when the organisation is ready."
              />
            )}
          </div>
        </div>
        <div className="panel quick-panel">
          <PanelHeader
            title="Prepared templates"
            subtitle="Start an alert from a template created by your organisation"
          />
          <div className="quick-list">
            {templates.slice(0, 3).map((template, index) => (
              <button
                key={template.id}
                disabled={!canCreateAlerts}
                onClick={() => onCreate(template)}
              >
                <span className={`quick-icon ${template.severity}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <b>{template.title}</b>
                  <small>{template.category}</small>
                </div>
                <ChevronRight size={17} />
              </button>
            ))}
            {!templates.length && (
              <EmptyState
                title="No templates yet"
                text="Create a message template before starting an alert."
              />
            )}
          </div>
        </div>
      </section>

      <section className="dashboard-grid lower-grid">
        <FacilitySnapshot facilities={facilities} />
        <div className="panel health-panel">
          <PanelHeader
            title="Channel health"
            subtitle="Configured delivery providers"
          />
          {channelSettings.map((setting) => (
            <HealthRow
              key={setting.id}
              icon={
                setting.channel === "sms"
                  ? MessageSquareText
                  : setting.channel === "email"
                    ? Mail
                    : Smartphone
              }
              label={
                setting.channel === "push"
                  ? "Android push"
                  : setting.channel.toUpperCase()
              }
              detail={setting.provider}
              value={
                setting.channel === "sms"
                  ? "Not available"
                  : setting.is_enabled
                    ? "Enabled"
                    : "Disabled"
              }
            />
          ))}
        </div>
      </section>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: typeof Radio;
  label: string;
  value: string | number;
  helper: string;
  tone: string;
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon size={21} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function BroadcastRow({
  item,
  onClick,
}: {
  item: Broadcast;
  onClick: () => void;
}) {
  return (
    <button className="broadcast-row" onClick={onClick}>
      <span className={`severity-dot ${item.severity}`}>
        <span />
      </span>
      <div className="broadcast-main">
        <b>{item.title}</b>
        <small>
          {item.facility} · {item.createdAt}
        </small>
      </div>
      <ChannelPills channels={item.channels} compact />
      <div className="delivery-cell">
        <b>{unreleasedAlertStatuses.includes(item.status) ? "—" : item.sent}</b>
        <small>{deliverySummary(item)}</small>
      </div>
      <span className={`status-pill ${item.status}`}>
        {alertStatusLabel[item.status]}
      </span>
      <ChevronRight size={17} />
    </button>
  );
}

function FacilitySnapshot({ facilities }: { facilities: Facility[] }) {
  const facility = facilities[0];
  if (!facility)
    return (
      <div className="panel facility-snapshot">
        <EmptyState
          title="No facility configured"
          text="Add a facility to enable location-based targeting."
        />
      </div>
    );
  return (
    <div className="panel facility-snapshot">
      <PanelHeader
        title={facility.name}
        subtitle="Employee assignments by building"
      />
      <div className="mini-map">
        <div className="map-road horizontal" />
        <div className="map-road vertical" />
        {facility.buildings.slice(0, 4).map((building, index) => (
          <div
            className={`mini-building b${index + 1}`}
            key={building.id}
          >
            <span>{building.name}</span>
            <i>{building.people}</i>
          </div>
        ))}
        <div className="muster">M</div>
      </div>
      <div className="map-legend">
        <b>{facility.people} assigned employees</b>
      </div>
    </div>
  );
}

function HealthRow({
  icon: Icon,
  label,
  detail,
  value,
}: {
  icon: typeof Mail;
  label: string;
  detail: string;
  value: string;
}) {
  return (
    <div className="health-row">
      <span>
        <Icon size={19} />
      </span>
      <div>
        <b>{label}</b>
        <small>{detail}</small>
      </div>
      <i />
      <em>{value}</em>
    </div>
  );
}

function BroadcastsPage({
  broadcasts,
  selected,
  onSelect,
  onClose,
  currentUserId,
  permissions,
  isPlatformAdmin,
  onSubmit,
  onEdit,
  onApprove,
  onReturn,
  onRelease,
  onResolve,
  onCancel,
  onNotify,
}: {
  broadcasts: Broadcast[];
  selected: Broadcast | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  currentUserId: string;
  permissions: string[];
  isPlatformAdmin: boolean;
  onSubmit: (id: string) => Promise<void>;
  onEdit: (id: string, message: string) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onReturn: (id: string, note: string) => Promise<void>;
  onRelease: (id: string) => Promise<void>;
  onResolve: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [view, setView] = useState<
    "active" | "pending_approval" | "draft" | "history" | "all"
  >(
    selected?.status === "pending_approval"
      ? "pending_approval"
      : selected?.status === "draft"
        ? "draft"
        : selected && historicalAlertStatuses.includes(selected.status)
          ? "history"
          : "active",
  );
  const [detail, setDetail] = useState<ApiAlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const can = (...required: string[]) =>
    isPlatformAdmin ||
    permissions.includes("*") ||
    required.some((permission) => permissions.includes(permission));
  const loadDetail = useCallback(async () => {
    if (!selected?.backendId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      setDetail(await api.alert(selected.backendId));
    } catch (error) {
      onNotify(
        error instanceof SignalOpsApiError
          ? error.message
          : "Unable to load alert details",
      );
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [onNotify, selected?.backendId]);
  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);
  const perform = async (action: () => Promise<void>) => {
    setActionBusy(true);
    try {
      await action();
      await loadDetail();
    } catch {
      // The parent action reports the API error in the application toast.
    } finally {
      setActionBusy(false);
    }
  };
  const visible = broadcasts.filter((item) => {
    const matchesSearch = `${item.title} ${item.facility} ${item.createdBy}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesView =
      view === "all" ||
      (view === "history"
        ? historicalAlertStatuses.includes(item.status)
        : item.status === view);
    return (
      matchesSearch &&
      matchesView &&
      (severityFilter === "all" || item.severity === severityFilter) &&
      (channelFilter === "all" ||
        item.channels.includes(channelFilter as Channel))
    );
  });
  const exportAlerts = () => {
    const csv = [
      "ID,Title,Severity,Status,Audience,Location,Recipients,Provider accepted,Confirmed delivered,Retrying,Permanently failed",
      ...visible.map((item) =>
        [
          item.id,
          item.title,
          item.severity,
          item.status,
          item.audience,
          item.facility,
          item.recipients,
          item.sent,
          item.delivered,
          item.retrying,
          item.failed,
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "signalops-alerts.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    onNotify("Alert export downloaded");
  };
  return (
    <>
      <div className="lifecycle-strip">
        <div>
          <Activity size={19} />
          <span>
            <b>
              {broadcasts.filter((item) => item.status === "active").length}
            </b>{" "}
            active alerts
          </span>
        </div>
        <ChevronRight size={16} />
        <div>
          <Inbox size={19} />
          <span>
            <b>
              {
                broadcasts.filter(
                  (item) => item.status === "pending_approval",
                ).length
              }
            </b>{" "}
            awaiting approval
          </span>
        </div>
        <ChevronRight size={16} />
        <div>
          <CheckCircle2 size={19} />
          <span>
            <b>
              {
                broadcasts.filter((item) => item.status === "resolved").length
              }
            </b>{" "}
            resolved
          </span>
        </div>
        <div>
          <X size={19} />
          <span>
            <b>{broadcasts.filter((item) => item.status === "cancelled").length}</b>{" "}
            cancelled
          </span>
        </div>
        <div>
          <AlertTriangle size={19} />
          <span>
            <b>{broadcasts.filter((item) => item.status === "failed").length}</b>{" "}
            failed
          </span>
        </div>
      </div>
      <div className="alert-tabs" role="tablist" aria-label="Alert status">
        {(
          [
            ["active", "Active"],
            ["pending_approval", "Awaiting approval"],
            ["draft", "Drafts"],
            ["history", "History"],
            ["all", "All alerts"],
          ] as const
        ).map(([id, label]) => (
          <button
            role="tab"
            aria-selected={view === id}
            className={view === id ? "active" : ""}
            key={id}
            onClick={() => {
              setView(id);
              onClose();
            }}
          >
            {label}
            <span>
              {id === "all"
                ? broadcasts.length
                : id === "history"
                  ? broadcasts.filter((item) =>
                      historicalAlertStatuses.includes(item.status),
                    ).length
                  : broadcasts.filter((item) => item.status === id).length}
            </span>
          </button>
        ))}
      </div>
      <div className={`split-view ${selected ? "has-detail" : ""}`}>
        <div className="panel data-panel">
          <div className="toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by alert, location or sender"
              />
            </div>
            <select
              aria-label="Filter by severity"
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value)}
            >
              <option value="all">All levels</option>
              <option value="critical">Critical</option>
              <option value="warning">Advisory</option>
              <option value="info">Information</option>
            </select>
            <select
              aria-label="Filter by channel"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
            >
              <option value="all">All channels</option>
              <option value="email">Email</option>
              <option value="android">Mobile app</option>
            </select>
            <button className="filter-button" onClick={exportAlerts}>
              <Download size={16} />
              Export
            </button>
          </div>
          <div className="broadcast-table-head">
            <span>Alert</span>
            <span>Audience</span>
            <span>Delivery</span>
            <span>Status</span>
            <span />
          </div>
          {visible.map((item) => (
            <button
              key={item.id}
              className={`broadcast-table-row ${selected?.id === item.id ? "selected" : ""}`}
              onClick={() => onSelect(item.id)}
            >
              <div>
                <span className={`severity-icon ${item.severity}`}>
                  <AlertTriangle size={17} />
                </span>
                <span>
                  <b>{item.title}</b>
                  <small>
                    {item.id} · {item.createdAt}
                  </small>
                </span>
              </div>
              <span>
                <b>{item.audience}</b>
                <small>{item.facility}</small>
              </span>
              <span>
                <b>{unreleasedAlertStatuses.includes(item.status) ? "—" : `${item.sent} accepted`}</b>
                <small>{deliverySummary(item)}</small>
              </span>
              <span className={`status-pill ${item.status}`}>
                {alertStatusLabel[item.status]}
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
          {!visible.length && (
            <EmptyState
              title={`No ${view === "history" ? "historical" : view} alerts`}
              text={
                query
                  ? "Try another search term."
                  : "Alerts will appear here as they move through this stage."
              }
            />
          )}
        </div>
        {selected && (
          <aside className="detail-panel">
            <div className="detail-top">
              <span className={`severity-label ${selected.severity}`}>
                {selected.severity}
              </span>
              <button onClick={onClose}>
                <X size={19} />
              </button>
            </div>
            <h2>{selected.title}</h2>
            <p className="detail-id">
              {selected.id} · {selected.createdAt}
            </p>
            <div className="message-preview">
              <span>MESSAGE</span>
              <p>{selected.message}</p>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Location</dt>
                <dd>
                  <MapPin size={16} />
                  {selected.facility}
                </dd>
              </div>
              <div>
                <dt>Audience</dt>
                <dd>
                  <Users size={16} />
                  {selected.audience}
                </dd>
              </div>
              <div>
                <dt>Sent by</dt>
                <dd>
                  <CircleUserRound size={16} />
                  {selected.createdBy}
                </dd>
              </div>
              <div>
                <dt>Channels</dt>
                <dd>
                  <ChannelPills channels={selected.channels} />
                </dd>
              </div>
            </dl>
            <div className="alert-detail-status">
              <span className={`status-pill ${selected.status}`}>
                {alertStatusLabel[selected.status]}
              </span>
              {detailLoading && <small>Refreshing details...</small>}
            </div>
            {detail && (
              <dl className="lifecycle-metadata">
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(detail.created_at)}</dd>
                </div>
                {detail.submitted_at && (
                  <div>
                    <dt>Submitted</dt>
                    <dd>{formatTimestamp(detail.submitted_at)}</dd>
                  </div>
                )}
                {detail.approved_at && (
                  <div>
                    <dt>Approved</dt>
                    <dd>
                      {detail.approved_by_name || "Authorised user"} ·{" "}
                      {formatTimestamp(detail.approved_at)}
                    </dd>
                  </div>
                )}
                {detail.resolved_at && (
                  <div>
                    <dt>Resolved</dt>
                    <dd>
                      {detail.resolved_by_name || "Authorised user"} ·{" "}
                      {formatTimestamp(detail.resolved_at)}
                    </dd>
                  </div>
                )}
                {detail.cancelled_at && (
                  <div>
                    <dt>Cancelled</dt>
                    <dd>
                      {detail.cancelled_by_name || "Authorised user"} ·{" "}
                      {formatTimestamp(detail.cancelled_at)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {selected.status === "failed" && (
              <div className="delivery-failure-note">
                <AlertTriangle size={18} />
                <span>
                  <b>Delivery failed</b>
                  <small>
                    No selected channel completed delivery. See each recipient's
                    eligibility, retry history, and failure reason below.
                  </small>
                </span>
              </div>
            )}
            <h3>Delivery progress</h3>
            <div className="delivery-stats">
              <div>
                <b>{detail?.recipient_count ?? selected.recipients}</b>
                <span>Recipients</span>
              </div>
              <div>
                <b>{detail?.sent_count ?? selected.sent}</b>
                <span>Provider accepted</span>
              </div>
              <div>
                <b>{detail?.delivered_count ?? selected.delivered}</b>
                <span>Confirmed delivered</span>
              </div>
              <div>
                <b>{detail?.retrying_count ?? selected.retrying}</b>
                <span>Retrying</span>
              </div>
              <div>
                <b>{detail?.failed_count ?? selected.failed}</b>
                <span>Permanent failures</span>
              </div>
            </div>
            {selected.requiresAcknowledgement && (
              <div className="ack-card">
                <div>
                  <span>
                    <CheckCircle2 size={18} />
                    Acknowledgements
                  </span>
                  <b>
                    {(detail?.recipient_count ?? selected.recipients)
                      ? Math.round(
                          ((detail?.acknowledged_count ?? selected.acknowledged) /
                            (detail?.recipient_count ?? selected.recipients)) *
                            100,
                        )
                      : 0}
                    %
                  </b>
                </div>
                <div className="progress">
                  <i
                    style={{
                      width: `${(detail?.recipient_count ?? selected.recipients) ? ((detail?.acknowledged_count ?? selected.acknowledged) / (detail?.recipient_count ?? selected.recipients)) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p>
                  <b>{detail?.acknowledged_count ?? selected.acknowledged} responded</b>
                  <span>
                    {(detail?.recipient_count ?? selected.recipients) -
                      (detail?.acknowledged_count ?? selected.acknowledged)}{" "}
                    awaiting response
                  </span>
                </p>
              </div>
            )}
            {selected.requiresAcknowledgement && (
              <div className="info-note">
                <CheckCircle2 size={18} />
                <span>
                  Open Employee responses for the live acknowledgement roster,
                  reminders, and assistance escalation.
                </span>
              </div>
            )}

            {detail?.approvals && detail.approvals.length > 0 && (
              <section className="alert-detail-section">
                <h3>Approval history</h3>
                <div className="approval-history">
                  {detail.approvals.map((approval) => (
                    <div key={approval.id}>
                      <ShieldCheck size={16} />
                      <span>
                        <b>
                          {approval.reviewer_name} {approval.decision} the alert
                        </b>
                        <small>
                          {new Date(approval.created_at).toLocaleString("en-IN")}
                          {approval.note ? ` · ${approval.note}` : ""}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {detail?.recipients && (
              <section className="alert-detail-section">
                <h3>Recipient delivery</h3>
                <div className="recipient-delivery-list">
                  {detail.recipients.map((recipient) => (
                    <div className="recipient-delivery-row" key={recipient.id}>
                      <div className="recipient-delivery-head">
                        <span>
                          <b>{recipient.full_name}</b>
                          <small>
                            {[recipient.facility_name, recipient.building_name]
                              .filter(Boolean)
                              .join(" · ") || "No location assignment"}
                          </small>
                        </span>
                        {selected.requiresAcknowledgement && (
                          <i
                            className={`acknowledgement-chip ${recipient.acknowledgement_status || "awaiting_response"}`}
                          >
                            {(recipient.acknowledgement_status || "awaiting response").replaceAll(
                              "_",
                              " ",
                            )}
                          </i>
                        )}
                      </div>
                      {recipient.acknowledgement_status && (
                        <small className="recipient-response-detail">
                          {recipient.note || "No response note"} ·{" "}
                          {formatTimestamp(recipient.acknowledged_at)}
                          {recipient.acknowledgement_source
                            ? ` · ${recipient.acknowledgement_source}`
                            : ""}
                        </small>
                      )}
                      <div className="delivery-detail-list">
                        {recipient.deliveries.map((delivery) => (
                          <details
                            className={`delivery-result ${deliveryState(delivery)}`}
                            key={delivery.id}
                          >
                            <summary>
                              <span>
                                <b>
                                  {delivery.channel === "push"
                                    ? "Mobile push"
                                    : delivery.channel.toUpperCase()}
                                </b>
                                <i>{deliveryStateLabel(delivery)}</i>
                              </span>
                              <small>
                                {delivery.provider || "Provider not selected"} ·{" "}
                                {delivery.attemptCount} attempt
                                {delivery.attemptCount === 1 ? "" : "s"}
                              </small>
                            </summary>
                            <dl>
                              <div>
                                <dt>Provider reference</dt>
                                <dd>{delivery.providerMessageId || "—"}</dd>
                              </div>
                              <div>
                                <dt>Accepted</dt>
                                <dd>{formatTimestamp(delivery.sentAt)}</dd>
                              </div>
                              <div>
                                <dt>Delivered</dt>
                                <dd>{formatTimestamp(delivery.deliveredAt)}</dd>
                              </div>
                              {delivery.nextAttemptAt && (
                                <div>
                                  <dt>Next retry</dt>
                                  <dd>{formatTimestamp(delivery.nextAttemptAt)}</dd>
                                </div>
                              )}
                              {(delivery.failureCode || delivery.failureMessage) && (
                                <div className="delivery-error-detail">
                                  <dt>Last failure</dt>
                                  <dd>
                                    {[delivery.failureCode, delivery.failureMessage]
                                      .filter(Boolean)
                                      .join(": ")}
                                  </dd>
                                </div>
                              )}
                            </dl>
                            {delivery.attempts.length > 0 && (
                              <div className="delivery-attempts">
                                <b>Attempt history</b>
                                {delivery.attempts.map((attempt) => (
                                  <small key={attempt.id}>
                                    #{attempt.attempt_number} ·{" "}
                                    {attempt.response_status
                                      ? `Provider response ${attempt.response_status}`
                                      : attempt.error_code || "No provider response"}
                                    {attempt.duration_ms !== null
                                      ? ` · ${attempt.duration_ms} ms`
                                      : ""}
                                    {` · ${formatTimestamp(attempt.attempted_at)}`}
                                  </small>
                                ))}
                              </div>
                            )}
                          </details>
                        ))}
                        {!recipient.deliveries.length && (
                          <i className="delivery-not-queued">
                            {unreleasedAlertStatuses.includes(selected.status)
                              ? "Not released"
                              : "No eligible channel"}
                          </i>
                        )}
                      </div>
                    </div>
                  ))}
                  {!detail.recipients.length && (
                    <p>No recipient snapshot exists for this alert.</p>
                  )}
                </div>
              </section>
            )}

            {detail?.assistance && detail.assistance.length > 0 && (
              <section className="alert-detail-section">
                <h3>Assistance requests</h3>
                <div className="assistance-history">
                  {detail.assistance.map((request) => (
                    <div className={request.status} key={request.id}>
                      <LifeBuoy size={16} />
                      <span>
                        <b>
                          {request.employee_name} · {request.status}
                        </b>
                        <small>
                          {request.note || "No note supplied"} ·{" "}
                          {formatTimestamp(request.created_at)}
                        </small>
                        {(request.assigned_to_name || request.resolved_by_name) && (
                          <small>
                            {request.resolved_by_name
                              ? `Resolved by ${request.resolved_by_name}`
                              : `Assigned to ${request.assigned_to_name}`}
                            {request.resolved_at
                              ? ` · ${formatTimestamp(request.resolved_at)}`
                              : ""}
                          </small>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {detail && (
              <section className="alert-detail-section">
                <h3>Immutable audit timeline</h3>
                <div className="alert-audit-timeline">
                  {detail.audit.map((event) => (
                    <div key={event.id}>
                      <Activity size={15} />
                      <span>
                        <b>
                          {event.action
                            .replaceAll(".", " ")
                            .replace(/\b\w/g, (letter) => letter.toUpperCase())}
                        </b>
                        <small>
                          {event.actor_name || "System"} ·{" "}
                          {formatTimestamp(event.created_at)}
                        </small>
                      </span>
                    </div>
                  ))}
                  {!can("audit.read") && (
                    <p>Your role does not include access to audit events.</p>
                  )}
                  {can("audit.read") && !detail.audit.length && (
                    <p>No audit events have been recorded for this alert.</p>
                  )}
                </div>
              </section>
            )}

            {selected.status === "draft" &&
              (can("alerts.create") || can("alerts.send")) && (
                <div className="approval-actions">
                  <div>
                    <FileText size={18} />
                    <span>
                      <b>Draft alert</b>
                      <small>Submit for review or release if authorised</small>
                    </span>
                  </div>
                  {can("alerts.create") && (
                    <>
                      {(detail?.created_by === currentUserId ||
                        isPlatformAdmin ||
                        permissions.includes("*")) && (
                        <button
                          className="secondary-button"
                          disabled={actionBusy}
                          onClick={() => setEditOpen(true)}
                        >
                          Edit message
                        </button>
                      )}
                      <button
                        className="secondary-button"
                        disabled={actionBusy}
                        onClick={() => perform(() => onSubmit(selected.id))}
                      >
                        Submit for approval
                      </button>
                    </>
                  )}
                  {can("alerts.send") && (
                    <button
                      className="primary-button"
                      disabled={actionBusy}
                      onClick={() => perform(() => onRelease(selected.id))}
                    >
                      <Send size={16} /> Release now
                    </button>
                  )}
                </div>
              )}
            {selected.status === "scheduled" && can("alerts.send") && (
              <div className="approval-actions">
                <div>
                  <Clock3 size={18} />
                  <span>
                    <b>Scheduled alert</b>
                    <small>Release it now if the incident has started</small>
                  </span>
                </div>
                <button
                  className="primary-button"
                  disabled={actionBusy}
                  onClick={() => perform(() => onRelease(selected.id))}
                >
                  <Send size={16} /> Release now
                </button>
              </div>
            )}
            {selected.status === "pending_approval" && (
              <div className="approval-actions">
                <div>
                  <ShieldCheck size={18} />
                  <span>
                    <b>Approval required</b>
                    <small>Submitted by {selected.createdBy}</small>
                  </span>
                </div>
                {can("alerts.approve") &&
                detail &&
                detail.created_by !== currentUserId ? (
                  <>
                    <button
                      className="primary-button"
                      disabled={actionBusy}
                      onClick={() => perform(() => onApprove(selected.id))}
                    >
                      <Send size={16} />
                      Approve & send
                    </button>
                    <button
                      className="text-button"
                      disabled={actionBusy}
                      onClick={() => {
                        const note = window.prompt(
                          "Explain what the creator must change:",
                        );
                        if (note === null) return;
                        if (!note.trim()) {
                          onNotify("A return reason is required");
                          return;
                        }
                        void perform(() => onReturn(selected.id, note.trim()));
                      }}
                    >
                      Return for changes
                    </button>
                  </>
                ) : (
                  <small>
                    {detail?.created_by === currentUserId
                      ? "A different authorised user must review this alert."
                      : "You do not have permission to review this alert."}
                  </small>
                )}
                {can("alerts.send") && (
                  <button
                    className="secondary-button"
                    disabled={actionBusy}
                    onClick={() => perform(() => onRelease(selected.id))}
                  >
                    Emergency release
                  </button>
                )}
              </div>
            )}
            {selected.status === "active" && (
              <div className="alert-lifecycle-actions">
                {can("alerts.resolve") && (
                  <button
                    className="resolve-button"
                    disabled={actionBusy}
                    onClick={() => perform(() => onResolve(selected.id))}
                  >
                    <Check size={18} />
                    Mark incident resolved
                  </button>
                )}
              </div>
            )}
            {["draft", "pending_approval", "scheduled", "active"].includes(
              selected.status,
            ) &&
              can("alerts.resolve") && (
                <button
                  className="danger-text-button alert-cancel-button"
                  disabled={actionBusy}
                  onClick={() => {
                    if (window.confirm("Cancel this alert? This cannot be undone."))
                      void perform(() => onCancel(selected.id));
                  }}
                >
                  Cancel alert
                </button>
              )}
          </aside>
        )}
      </div>
      {editOpen && selected && detail && (
        <EditAlertModal
          alert={selected}
          returnReason={
            [...detail.approvals]
              .reverse()
              .find((approval) => approval.decision === "returned")?.note || null
          }
          onClose={() => setEditOpen(false)}
          onSave={async (message) => {
            await onEdit(selected.id, message);
            await loadDetail();
          }}
        />
      )}
    </>
  );
}

function PeoplePage({
  recipients,
  departments,
  groups,
  facilities,
  canManageUsers,
  canManageDirectory,
  onRecipientsChange,
  onDepartmentsChange,
  onGroupsChange,
  onResendInvitation,
  onNotify,
}: {
  recipients: Recipient[];
  departments: Department[];
  groups: AudienceGroup[];
  facilities: Facility[];
  canManageUsers: boolean;
  canManageDirectory: boolean;
  onRecipientsChange: (people: Recipient[]) => void;
  onDepartmentsChange: (departments: Department[]) => void;
  onGroupsChange: (groups: AudienceGroup[]) => void;
  onResendInvitation: (id: string) => void;
  onNotify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All departments");
  const [view, setView] = useState<"people" | "groups" | "departments">(
    "people",
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [editingPerson, setEditingPerson] = useState<Recipient | null>(null);
  const [editingGroup, setEditingGroup] = useState<AudienceGroup | null>(null);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(
    null,
  );
  const visible = recipients.filter(
    (person) =>
      `${person.name} ${person.email} ${person.role}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (department === "All departments" || person.department === department),
  );
  const departmentOptions = [
    "All departments",
    ...departments.map((item) => item.name),
  ];
  const createGroup = () => {
    if (!canManageDirectory || !newGroupName.trim()) return;
    onGroupsChange([
      ...groups,
      {
        id: crypto.randomUUID(),
        tenantId: recipients[0]?.tenantId ?? "",
        name: newGroupName.trim(),
        description: "Custom alert audience",
        memberIds: [],
      },
    ]);
    setNewGroupName("");
    onNotify("Audience group created");
  };
  const exportPeople = () => {
    const csv = [
      "Name,Email,Phone,Role,Department,Facility,Building,Status",
      ...visible.map((person) =>
        [
          person.name,
          person.email,
          person.phone,
          person.role,
          person.department,
          person.facility,
          person.building,
          person.status,
        ]
          .map((value) => `"${value.replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "signalops-people.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    onNotify("People export downloaded");
  };
  return (
    <>
      <div className="directory-stats">
        <div>
          <Users size={20} />
          <span>
            <b>{recipients.length}</b> people in directory
          </span>
        </div>
        <div>
          <CheckCircle2 size={20} />
          <span>
            <b>{departments.length}</b> departments
          </span>
        </div>
        <div>
          <UsersRound size={20} />
          <span>
            <b>{groups.length}</b> saved groups
          </span>
        </div>
      </div>
      <div className="alert-tabs">
        <button
          className={view === "people" ? "active" : ""}
          onClick={() => setView("people")}
        >
          People <span>{recipients.length}</span>
        </button>
        <button
          className={view === "groups" ? "active" : ""}
          onClick={() => setView("groups")}
        >
          Groups <span>{groups.length}</span>
        </button>
        <button
          className={view === "departments" ? "active" : ""}
          onClick={() => setView("departments")}
        >
          Departments <span>{departments.length}</span>
        </button>
      </div>
      {view === "people" ? (
        <div className="panel data-panel">
          <div className="toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, role or email"
              />
            </div>
            <select
              aria-label="Filter by department"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
            >
              {departmentOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <button className="filter-button" onClick={exportPeople}>
              <Download size={16} />
              Export
            </button>
          </div>
          <div className="people-table-head no-channels">
            <span>Person</span>
            <span>Role & department</span>
            <span>Location</span>
            <span>Mobile app</span>
            <span>Status</span>
            <span />
          </div>
          {visible.map((person) => (
            <div className="people-row" key={person.id}>
              <div>
                <span className="person-avatar">{person.initials}</span>
                <span>
                  <b>{person.name}</b>
                  <small>
                    {person.email}
                    <br />
                    {person.phone}
                  </small>
                </span>
              </div>
              <span>
                <b>{person.role}</b>
                <small>{person.department}</small>
              </span>
              <span>
                <b>{person.facility}</b>
                <small>{person.building}</small>
              </span>
              <button
                className={`device-state ${person.status === "active" ? "ready" : "pending"}`}
                disabled={!canManageUsers || person.status !== "invited"}
                onClick={() => onResendInvitation(person.id)}
              >
                <i>
                  <Smartphone size={15} />
                </i>
                <span>
                  <b>
                    {person.status === "active"
                      ? "App access active"
                      : person.status === "invited"
                        ? "Invite pending"
                        : "Access unavailable"}
                  </b>
                  <small>
                    {person.status === "invited"
                      ? "Resend invite"
                      : person.status === "active"
                        ? "Activation complete"
                        : person.status}
                  </small>
                </span>
              </button>
              <span className={`status-pill ${person.status}`}>
                {person.status}
              </span>
              {canManageUsers ? (
                <button
                  title={`Manage ${person.name}`}
                  onClick={() => setEditingPerson(person)}
                >
                  <MoreHorizontal size={18} />
                </button>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      ) : view === "groups" ? (
        <div className="panel data-panel">
          {canManageDirectory && (
            <div className="toolbar">
              <div className="search-box">
                <UsersRound size={17} />
                <input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="New group name"
                />
              </div>
              <button className="primary-button" onClick={createGroup}>
                <Plus size={16} />
                Create group
              </button>
            </div>
          )}
          <div className="group-grid">
            {groups.map((group) => {
              const members = recipients.filter((person) =>
                group.memberIds.includes(person.id),
              );
              return (
                <div className="group-card" key={group.id}>
                  <span className="stat-icon blue">
                    <UsersRound size={20} />
                  </span>
                  <div>
                    <b>{group.name}</b>
                    <small>{group.description}</small>
                    <em>
                      {members.length
                        ? members.map((person) => person.name).join(", ")
                        : "No members yet"}
                    </em>
                  </div>
                  {canManageDirectory && (
                    <button onClick={() => setEditingGroup(group)}>Manage</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="panel data-panel">
          <div className="group-grid">
            {departments.map((item) => (
              <div className="group-card" key={item.id}>
                <span className="stat-icon purple">
                  <Building2 size={20} />
                </span>
                <div>
                  <b>{item.name}</b>
                  <small>{item.description}</small>
                  <em>
                    {
                      recipients.filter(
                        (person) => person.department === item.name,
                      ).length
                    }{" "}
                    people
                  </em>
                </div>
                {canManageDirectory && (
                  <button onClick={() => setEditingDepartment(item)}>
                    Manage
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {editingPerson && canManageUsers && (
        <PersonEditorModal
          person={editingPerson}
          departments={departments}
          facilities={facilities}
          onClose={() => setEditingPerson(null)}
          onSave={(next) => {
            onRecipientsChange(
              recipients.map((item) => (item.id === next.id ? next : item)),
            );
            setEditingPerson(null);
          }}
          onDelete={() => {
            onRecipientsChange(
              recipients.filter((item) => item.id !== editingPerson.id),
            );
            if (canManageDirectory)
              onGroupsChange(
                groups.map((group) => ({
                  ...group,
                  memberIds: group.memberIds.filter(
                    (id) => id !== editingPerson.id,
                  ),
                })),
              );
            setEditingPerson(null);
          }}
        />
      )}
      {editingGroup && canManageDirectory && (
        <GroupEditorModal
          group={editingGroup}
          people={recipients}
          onClose={() => setEditingGroup(null)}
          onSave={(next) => {
            onGroupsChange(
              groups.map((item) => (item.id === next.id ? next : item)),
            );
            setEditingGroup(null);
          }}
          onDelete={() => {
            onGroupsChange(
              groups.filter((item) => item.id !== editingGroup.id),
            );
            setEditingGroup(null);
          }}
        />
      )}
      {editingDepartment && canManageDirectory && (
        <DepartmentEditorModal
          department={editingDepartment}
          onClose={() => setEditingDepartment(null)}
          onSave={(next) => {
            onDepartmentsChange(
              departments.map((item) => (item.id === next.id ? next : item)),
            );
            setEditingDepartment(null);
          }}
          onDelete={() => {
            if (
              recipients.some(
                (person) => person.department === editingDepartment.name,
              )
            ) {
              onNotify(
                "Move people out of this department before deleting it.",
              );
              return;
            }
            onDepartmentsChange(
              departments.filter((item) => item.id !== editingDepartment.id),
            );
            setEditingDepartment(null);
          }}
        />
      )}
    </>
  );
}

type EmployeeResponse = {
  personId: string;
  status: "safe" | "awaiting" | "assistance";
  respondedAt: string;
  note: string;
  reminded: boolean;
  escalated: boolean;
  assistanceId?: string;
};
function ResponsesPage({
  broadcasts,
  recipients,
  canManageResponses,
  canReadAudit,
  onNotify,
}: {
  broadcasts: Broadcast[];
  recipients: Recipient[];
  canManageResponses: boolean;
  canReadAudit: boolean;
  onNotify: (message: string) => void;
}) {
  const acknowledgementAlerts = broadcasts.filter(
    (item) => item.requiresAcknowledgement,
  );
  const [alertId, setAlertId] = useState(acknowledgementAlerts[0]?.id ?? "");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [responses, setResponses] = useState<EmployeeResponse[]>([]);
  const [auditEvents, setAuditEvents] = useState<ApiAuditEvent[]>([]);
  const selectedAlert =
    acknowledgementAlerts.find((item) => item.id === alertId) ??
    acknowledgementAlerts[0];
  useEffect(() => {
    if (!alertId && acknowledgementAlerts[0])
      setAlertId(acknowledgementAlerts[0].id);
  }, [acknowledgementAlerts, alertId]);
  useEffect(() => {
    if (!selectedAlert?.backendId) {
      setResponses([]);
      return;
    }
    api
      .alertResponses(selectedAlert.backendId)
      .then((rows) =>
        setResponses(
          rows.map((row) => ({
            personId: row.user_id,
            status:
              row.status === "needs_assistance"
                ? "assistance"
                : row.status === "safe" || row.status === "acknowledged"
                  ? "safe"
                  : "awaiting",
            respondedAt: row.acknowledged_at
              ? new Date(row.acknowledged_at).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Not responded",
            note: row.note || "",
            reminded: false,
            escalated: row.assistance_status === "assigned",
            assistanceId: row.assistance_id || undefined,
          })),
        ),
      )
      .catch((error) =>
        onNotify(
          error instanceof SignalOpsApiError
            ? error.message
            : "Unable to load employee responses",
        ),
      );
  }, [onNotify, selectedAlert?.backendId]);
  useEffect(() => {
    if (!selectedAlert?.backendId || !canReadAudit) {
      setAuditEvents([]);
      return;
    }
    api
      .alertAudit(selectedAlert.backendId)
      .then(setAuditEvents)
      .catch((error) =>
        onNotify(
          error instanceof SignalOpsApiError
            ? error.message
            : "Unable to load incident audit history",
        ),
      );
  }, [canReadAudit, onNotify, selectedAlert?.backendId]);
  const visible = responses
    .map((response) => ({
      response,
      person: recipients.find((item) => item.id === response.personId),
    }))
    .filter(
      (item) =>
        item.person &&
        (filter === "all" || item.response.status === filter) &&
        `${item.person?.name} ${item.person?.department} ${item.person?.facility}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  const count = (status: EmployeeResponse["status"]) =>
    responses.filter((item) => item.status === status).length;
  const update = (personId: string, patch: Partial<EmployeeResponse>) =>
    setResponses((current) =>
      current.map((item) =>
        item.personId === personId ? { ...item, ...patch } : item,
      ),
    );
  const remind = async (userIds?: string[]) => {
    if (!selectedAlert?.backendId || !canManageResponses) return;
    try {
      await api.remindAlertRecipients(selectedAlert.backendId, userIds);
      setResponses((current) =>
        current.map((item) =>
          (!userIds || userIds.includes(item.personId)) &&
          item.status === "awaiting"
            ? { ...item, reminded: true }
            : item,
        ),
      );
      onNotify("Reminder queued for non-responsive employees");
    } catch (error) {
      onNotify(
        error instanceof SignalOpsApiError
          ? error.message
          : "Unable to queue reminders",
      );
    }
  };
  const escalate = async (response: EmployeeResponse, name: string) => {
    if (!response.assistanceId || !canManageResponses) return;
    try {
      await api.updateAssistance(response.assistanceId, { status: "assigned" });
      update(response.personId, { escalated: true });
      onNotify(`Emergency response escalated for ${name}`);
    } catch (error) {
      onNotify(
        error instanceof SignalOpsApiError
          ? error.message
          : "Unable to escalate assistance request",
      );
    }
  };
  if (!selectedAlert) {
    return (
      <div className="panel response-empty-panel">
        <EmptyState
          title="No acknowledgement alerts yet"
          text="Employee responses will appear here after an alert requiring acknowledgement is sent."
        />
      </div>
    );
  }
  return (
    <>
      <div className="response-incident-bar">
        <div>
          <span className="severity-icon critical">
            <AlertTriangle size={18} />
          </span>
          <div>
            <small>MONITORING INCIDENT</small>
            <select
              value={alertId}
              onChange={(event) => setAlertId(event.target.value)}
            >
              {acknowledgementAlerts.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title} · {item.id}
                </option>
              ))}
            </select>
          </div>
        </div>
        <span className="status-chip">
          CURRENT STATUS
        </span>
      </div>
      <div className="response-stats">
        <div>
          <CheckCircle2 size={21} />
          <span>
            <b>{count("safe")}</b> confirmed safe
          </span>
        </div>
        <div>
          <Clock3 size={21} />
          <span>
            <b>{count("awaiting")}</b> awaiting response
          </span>
        </div>
        <div className="danger">
          <LifeBuoy size={21} />
          <span>
            <b>{count("assistance")}</b> need assistance
          </span>
        </div>
        <div>
          <Users size={21} />
          <span>
            <b>{responses.length}</b> targeted employees
          </span>
        </div>
      </div>
      <div className="panel data-panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search employee, department or location"
            />
          </div>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All responses</option>
            <option value="safe">Safe</option>
            <option value="awaiting">Awaiting response</option>
            <option value="assistance">Needs assistance</option>
          </select>
          {canManageResponses && (
            <button className="filter-button" onClick={() => remind()}>
              <Send size={15} />
              Remind all awaiting
            </button>
          )}
        </div>
        <div className="response-table-head">
          <span>Employee</span>
          <span>Assignment</span>
          <span>Response</span>
          <span>Time / note</span>
          <span>Action</span>
        </div>
        {visible.map(
          ({ person, response }) =>
            person && (
              <div
                className={`response-row ${response.status}`}
                key={person.id}
              >
                <div>
                  <span className="person-avatar">{person.initials}</span>
                  <span>
                    <b>{person.name}</b>
                    <small>
                      {person.role} · {person.department}
                    </small>
                  </span>
                </div>
                <span>
                  <b>{person.facility}</b>
                  <small>{person.building}</small>
                </span>
                <span className={`response-status ${response.status}`}>
                  {response.status === "safe"
                    ? "Confirmed safe"
                    : response.status === "assistance"
                      ? "Needs assistance"
                      : "Awaiting response"}
                </span>
                <span>
                  <b>{response.respondedAt}</b>
                  <small>
                    {response.note ||
                      (response.reminded
                        ? "Reminder sent"
                        : "No additional note")}
                  </small>
                </span>
                <span>
                  {response.status === "awaiting" && canManageResponses && (
                    <button onClick={() => remind([person.id])}>Remind</button>
                  )}
                  {response.status === "assistance" && canManageResponses && (
                    <button
                      className="danger"
                      disabled={!response.assistanceId}
                      onClick={() => escalate(response, person.name)}
                    >
                      {response.escalated ? "Escalated" : "Escalate"}
                    </button>
                  )}
                  {response.status === "safe" && <Check size={17} />}
                </span>
              </div>
            ),
        )}
      </div>
      <div className="response-audit panel">
        <PanelHeader
          title="Incident response audit"
          subtitle="Immutable events recorded by the backend"
        />
        <div className="audit-events">
          {auditEvents.map((event) => (
            <div
              className={event.action.includes("assistance") ? "danger" : ""}
              key={event.id}
            >
              {event.action.includes("assistance") ? (
                <LifeBuoy size={17} />
              ) : (
                <CheckCircle2 size={17} />
              )}
              <span>
                <b>
                  {event.action
                    .replaceAll(".", " ")
                    .replace(/\b\w/g, (letter) => letter.toUpperCase())}
                </b>
                <small>
                  {event.actor_name || "System"} ·{" "}
                  {new Date(event.created_at).toLocaleString("en-IN")}
                </small>
              </span>
            </div>
          ))}
          {!canReadAudit && (
            <p>Your role does not include permission to read audit events.</p>
          )}
          {canReadAudit && !auditEvents.length && (
            <p>No audit events have been recorded for this alert yet.</p>
          )}
        </div>
      </div>
    </>
  );
}

function FacilitiesPage({
  tenantId,
  facilities,
  canManage,
  onChange,
}: {
  tenantId: string;
  facilities: Facility[];
  canManage: boolean;
  onChange: (facilities: Facility[]) => void;
}) {
  const tenantFacilities = facilities.filter(
    (item) => item.tenantId === tenantId,
  );
  const firstFacilityId = tenantFacilities[0]?.id;
  const [selectedId, setSelectedId] = useState(firstFacilityId);
  const [editing, setEditing] = useState<Facility | null>(null);
  useEffect(() => setSelectedId(firstFacilityId), [tenantId, firstFacilityId]);
  const selected =
    tenantFacilities.find((item) => item.id === selectedId) ??
    tenantFacilities[0];
  if (!selected)
    return (
      <EmptyState
        title="No facilities configured"
        text="Add your first facility to start location-based alerts."
      />
    );
  return (
    <>
      <div className="facility-layout">
        <div className="facility-list">
          {tenantFacilities.map((item) => (
            <button
              key={item.id}
              className={selected.id === item.id ? "selected" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="facility-icon">
                <Building2 size={20} />
              </span>
              <span>
                <b>{item.name}</b>
                <small>{item.city}</small>
                <em>
                  {item.buildings.length} buildings · {item.people} people
                </em>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
        <div className="panel facility-detail">
          <div className="facility-detail-head">
            <div>
              <h2>{selected.name}</h2>
              <p>
                <MapPin size={15} />
                {selected.address}
              </p>
            </div>
            {canManage && (
              <button
                className="secondary-button"
                onClick={() => setEditing(selected)}
              >
                <Settings size={16} />
                Manage
              </button>
            )}
          </div>
          <div className="site-map">
            <div className="site-grid" />
            <div className="site-road horizontal" />
            <div className="site-road vertical" />
            {selected.buildings.map((building) => (
              <button
                key={building.id}
                title={`Edit ${building.name}`}
                onClick={() => canManage && setEditing(selected)}
                className="site-building"
                disabled={!canManage}
                style={{
                  left: `${building.x}%`,
                  top: `${building.y}%`,
                  width: `${building.w}%`,
                  height: `${building.h}%`,
                }}
              >
                <Building2 size={20} />
                <b>{building.name}</b>
                <span>{building.people} people</span>
              </button>
            ))}
          </div>
          <div className="building-summary">
            <span>
              <b>{selected.people}</b> assigned employees
            </span>
            <span>
              <b>{selected.buildings.length}</b> buildings
            </span>
          </div>
        </div>
      </div>
      {editing && canManage && (
        <FacilityEditorModal
          tenantId={tenantId}
          facility={editing}
          onClose={() => setEditing(null)}
          onDelete={() => {
            onChange(facilities.filter((item) => item.id !== editing.id));
            setEditing(null);
          }}
          onSave={(next) => {
            onChange(
              facilities.map((item) => (item.id === next.id ? next : item)),
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function TemplatesPage({
  templates,
  categories,
  canManage,
  canCreateAlerts,
  onCategoriesChange,
  onUse,
  onChange,
}: {
  templates: MessageTemplate[];
  categories: string[];
  canManage: boolean;
  canCreateAlerts: boolean;
  onCategoriesChange: (categories: string[]) => void;
  onUse: (preset: MessageTemplate) => void;
  onChange: (templates: MessageTemplate[]) => void;
}) {
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  return (
    <>
      <div className="template-grid">
        {templates.map((template) => (
          <div className="template-card" key={template.id}>
            <div>
              <span className={`severity-icon ${template.severity}`}>
                <FileText size={18} />
              </span>
              <span className={`severity-label ${template.severity}`}>
                {template.category}
              </span>
              {canManage && (
                <button
                  title={`Edit ${template.title}`}
                  onClick={() => setEditing(template)}
                >
                  <MoreHorizontal size={18} />
                </button>
              )}
            </div>
            <h3>{template.title}</h3>
            <p>{template.message}</p>
            <ChannelPills channels={template.channels} />
            <footer>
              <span>
                {template.requiresAcknowledgement
                  ? "Acknowledgement required"
                  : "No acknowledgement"}
              </span>
              {canCreateAlerts && (
                <button onClick={() => onUse(template)}>
                  Use template <ChevronRight size={15} />
                </button>
              )}
            </footer>
          </div>
        ))}
      </div>
      {editing && canManage && (
        <TemplateEditorModal
          tenantId={editing.tenantId}
          template={editing}
          categories={categories}
          onCategoriesChange={onCategoriesChange}
          onClose={() => setEditing(null)}
          onDelete={() => {
            onChange(templates.filter((item) => item.id !== editing.id));
            setEditing(null);
          }}
          onSave={(next) => {
            onChange(
              templates.map((item) => (item.id === next.id ? next : item)),
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function RolesPage({
  roles,
  portalUsers,
  canManageRoles,
  canManageUsers,
  canManageWorkspace,
  onReload,
  onNotify,
}: {
  roles: ApiRole[];
  portalUsers: Recipient[];
  canManageRoles: boolean;
  canManageUsers: boolean;
  canManageWorkspace: boolean;
  onReload: () => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const [editing, setEditing] = useState<ApiRole | null>(null);
  const [inviting, setInviting] = useState(false);
  const [permissions, setPermissions] = useState<ApiPermission[]>([]);
  const [approvalEnabled, setApprovalEnabled] = useState(true);
  useEffect(() => {
    if (canManageRoles)
      api
        .permissions()
        .then(setPermissions)
        .catch(() => onNotify("Unable to load role permissions"));
    api
      .settings()
      .then((value) =>
        setApprovalEnabled(value.preferences.critical_alert_approval),
      )
      .catch(() => undefined);
  }, [canManageRoles, onNotify]);
  const save = async (role: ApiRole) => {
    if (!canManageRoles) return;
    try {
      const payload = {
        name: role.name,
        description: role.description || "",
        audience: role.audience,
        permissions: role.permissions,
        isActive: role.is_active,
      };
      if (role.id) await api.updateRole(role.id, payload);
      else await api.createRole(payload);
      await onReload();
      setEditing(null);
      onNotify(role.id ? "Role updated" : "Role created");
    } catch (error) {
      onNotify(
        error instanceof SignalOpsApiError
          ? error.message
          : "Unable to save role",
      );
    }
  };
  const toggleApproval = async () => {
    if (!canManageWorkspace) return;
    try {
      const next = !approvalEnabled;
      await api.updateSettings({ criticalAlertApproval: next });
      setApprovalEnabled(next);
      onNotify(`Approval workflow ${next ? "enabled" : "disabled"}`);
    } catch (error) {
      onNotify(
        error instanceof SignalOpsApiError
          ? error.message
          : "Unable to update approval policy",
      );
    }
  };
  const tones = ["purple", "red", "blue", "green", "grey"];
  return (
    <>
      <div className="governance-grid">
        <div className="panel roles-panel">
          <PanelHeader
            title="Organisation roles"
            subtitle="Permissions follow least-privilege access"
            action={
              canManageRoles || canManageUsers ? (
              <div className="page-actions">
                {canManageUsers && (
                <button
                  className="secondary-button"
                  onClick={() => setInviting(true)}
                >
                  <Mail size={16} />
                  Invite portal user
                </button>
                )}
                {canManageRoles && (
                <button
                  className="secondary-button"
                  onClick={() =>
                    setEditing({
                      id: "",
                      name: "",
                      description: "",
                      audience: "portal",
                      is_system: false,
                      is_active: true,
                      permissions: ["workspace.read"],
                      user_count: 0,
                    })
                  }
                >
                  <Plus size={16} />
                  Create role
                </button>
                )}
              </div>
              ) : undefined
            }
          />
          {roles.map((role, index) => (
            <div className="role-row" key={role.id}>
              <span className={`role-icon ${tones[index % tones.length]}`}>
                <LockKeyhole size={18} />
              </span>
              <div>
                <b>{role.name}</b>
                <small>{role.description}</small>
              </div>
              <span>{role.user_count} people</span>
              <button
                title={`Manage ${role.name}`}
                disabled={!canManageRoles}
                onClick={() => setEditing(role)}
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          ))}
          <div className="section-heading">
            <div>
              <b>Portal users</b>
              <small>Administrators and operational portal access</small>
            </div>
          </div>
          {portalUsers.map((person) => (
            <div className="role-row" key={person.id}>
              <span className="person-avatar">{person.initials}</span>
              <div>
                <b>{person.name}</b>
                <small>{person.email}</small>
              </div>
              <span className={`status-pill ${person.status}`}>
                {person.status}
              </span>
              <button
                title={
                  person.status === "invited"
                    ? `Resend invitation to ${person.name}`
                    : `${person.name} is active`
                }
                disabled={person.status !== "invited"}
                hidden={!canManageUsers}
                onClick={async () => {
                  try {
                    await api.resendInvitation(person.id);
                    onNotify("Portal invitation sent");
                  } catch (error) {
                    onNotify(
                      error instanceof SignalOpsApiError
                        ? error.message
                        : "Unable to resend invitation",
                    );
                  }
                }}
              >
                <Mail size={17} />
              </button>
            </div>
          ))}
        </div>
        <div className="panel approval-panel">
          <PanelHeader
            title="Approval workflow"
            subtitle="Organisation release policy"
          />
          <div className="policy-status">
            <CheckCircle2 size={19} />
            <span>
              <b>
                Role-based approval is{" "}
                {approvalEnabled ? "enabled" : "disabled"}
              </b>
              <small>
                {approvalEnabled
                  ? "Critical alerts are protected by policy"
                  : "Authorized senders release alerts directly"}
              </small>
            </span>
          </div>
          <div className="approval-flow">
            <div>
              <span className="flow-number">1</span>
              <p>
                <b>Alert created</b>
                <small>Communication manager submits a critical alert</small>
              </p>
            </div>
            <i />
            <div>
              <span className="flow-number">2</span>
              <p>
                <b>Approval requested</b>
                <small>Emergency controllers are notified instantly</small>
              </p>
            </div>
            <i />
            <div>
              <span className="flow-number">3</span>
              <p>
                <b>Alert released</b>
                <small>First approval sends through selected channels</small>
              </p>
            </div>
          </div>
          <div className="bypass-note">
            <Zap size={18} />
            <div>
              <b>Emergency bypass</b>
              <p>
                Emergency controllers and organisation administrators can send
                immediately when every second matters.
              </p>
            </div>
          </div>
          <button
            className="secondary-button wide"
            disabled={!canManageWorkspace}
            onClick={toggleApproval}
          >
            {approvalEnabled
              ? "Disable approval workflow"
              : "Enable approval workflow"}
          </button>
        </div>
      </div>
      {editing && canManageRoles && (
        <RoleEditorModal
          role={editing}
          permissions={permissions}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {inviting && canManageUsers && (
        <InvitePortalUserModal
          roles={roles.filter((role) => role.audience === "portal")}
          onClose={() => setInviting(false)}
          onSave={async (value) => {
            try {
              await api.createUser(value);
              await onReload();
              setInviting(false);
              onNotify("Portal invitation sent");
            } catch (error) {
              onNotify(
                error instanceof SignalOpsApiError
                  ? error.message
                  : "Unable to invite portal user",
              );
            }
          }}
        />
      )}
    </>
  );
}

function AccountPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [account, setAccount] = useState<{
    status: "valid" | "completed" | "expired";
    audience: "portal" | "employee";
    full_name: string;
    email: string;
    tenant_name: string;
  } | null>(null);
  const [validating, setValidating] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<
    "completed" | "expired" | "invalid" | null
  >(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!token) {
      setError("This activation link is incomplete.");
      setOutcome("invalid");
      setValidating(false);
      return;
    }
    api
      .validateInvitation(token)
      .then((invitation) => {
        setAccount(invitation);
        if (invitation.status !== "valid") setOutcome(invitation.status);
      })
      .catch((problem) => {
        setError(
          problem instanceof SignalOpsApiError
            ? problem.message
            : "This activation link is invalid or expired.",
        );
        setOutcome("invalid");
      })
      .finally(() => setValidating(false));
  }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 10) {
      setError("Use a password with at least 10 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!token) {
      setError("This link is incomplete.");
      return;
    }
    setSaving(true);
    try {
      const result = await api.activateAccount(token, password);
      setAccount((current) =>
        current
          ? {
              ...current,
              status: "completed",
              audience:
                result.audience === "employee" ? "employee" : "portal",
              email: result.email,
            }
          : current,
      );
      setOutcome("completed");
    } catch (problem) {
      setError(
        problem instanceof SignalOpsApiError
          ? problem.message
          : "Unable to save the password.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-form-section">
          {validating ? (
            <>
              <h1>Checking invitation</h1>
              <p>Verifying your secure SignalOps activation link.</p>
              <div className="activation-status-card neutral" role="status">
                <Clock3 size={22} />
                <div>
                  <b>Please wait</b>
                  <span>This should only take a moment.</span>
                </div>
              </div>
            </>
          ) : outcome ? (
            <>
              <h1>
                {outcome === "completed"
                  ? "Account setup complete"
                  : outcome === "expired"
                    ? "Invitation expired"
                    : "Invitation unavailable"}
              </h1>
              <p>
                {outcome === "completed"
                  ? account?.audience === "employee"
                    ? "Your mobile account is active and ready to use."
                    : "Your portal account is active and ready to use."
                  : "This secure invitation can no longer be used."}
              </p>
              <div
                className={`activation-status-card ${outcome === "completed" ? "success" : "neutral"}`}
                role="status"
              >
                {outcome === "completed" ? (
                  <CheckCircle2 size={24} />
                ) : (
                  <Clock3 size={24} />
                )}
                <div>
                  <b>
                    {outcome === "completed"
                      ? account?.audience === "employee"
                        ? "Continue in the SignalOps mobile app"
                        : "Portal access activated"
                      : "No further action is available on this link"}
                  </b>
                  <span>
                    {outcome === "completed"
                      ? account?.audience === "employee"
                        ? `Open the SignalOps app and sign in using ${account.email}. You can safely close this page.`
                        : "Continue to the administrator portal to sign in."
                      : outcome === "expired"
                        ? "Ask your organisation administrator to send a new invitation if setup was not completed."
                        : error ||
                          "The link may be incomplete, invalid, or already replaced by a newer invitation."}
                  </span>
                </div>
              </div>
              {outcome === "completed" && account?.audience === "portal" && (
                <button
                  className="login-submit activation-portal-action"
                  onClick={() => {
                    window.location.href = "/";
                  }}
                >
                  Continue to portal sign in
                </button>
              )}
            </>
          ) : (
            <>
              <h1>Activate your account</h1>
              <p>
                {account
                  ? `${account.full_name}, finish setting up your ${account.tenant_name} account.`
                  : "Enter and confirm your new password."}
              </p>
              <form onSubmit={submit}>
                <label htmlFor="new-password">New password</label>
                <div className="login-password">
                  <input
                    id="new-password"
                    className="login-input"
                    type={showPassword ? "text" : "password"}
                    minLength={10}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password"
                  className="login-input"
                  type={showPassword ? "text" : "password"}
                  minLength={10}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
                {error && <div className="login-error">{error}</div>}
                <button
                  className="login-submit"
                  disabled={saving || !account}
                >
                  {saving ? "Saving…" : "Activate account"}
                </button>
              </form>
            </>
          )}
        </div>
        <aside
          className="login-visual"
          aria-label="Secure SignalOps account setup"
        >
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
          <img
            className="astronaut-image"
            src="/images/astro.png"
            alt="Astronaut floating in space"
          />
        </aside>
      </section>
    </main>
  );
}

function PasswordRecoveryPage() {
  const initialEmail = new URLSearchParams(window.location.search).get("email") || "";
  const [stage, setStage] = useState<"request" | "verify" | "password" | "complete">("request");
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const problemMessage = (problem: unknown, fallback: string) =>
    problem instanceof SignalOpsApiError ? problem.message : fallback;

  const requestCode = async (event?: FormEvent) => {
    event?.preventDefault();
    setError("");
    setMessage("");
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.forgotPassword(email.trim().toLowerCase());
      setStage("verify");
      setOtp("");
      setMessage(`${result.message}. Check your inbox and spam folder.`);
    } catch (problem) {
      setError(problemMessage(problem, "Unable to send a verification code."));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.verifyPasswordReset(email.trim(), otp);
      setResetToken(result.resetToken);
      setStage("password");
    } catch (problem) {
      setError(problemMessage(problem, "Unable to verify the code."));
    } finally {
      setLoading(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 10) {
      setError("Use a password with at least 10 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!resetToken) {
      setError("Your password reset session has expired. Request a new code.");
      setStage("request");
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(resetToken, password);
      setResetToken("");
      setStage("complete");
    } catch (problem) {
      setError(problemMessage(problem, "Unable to reset the password."));
    } finally {
      setLoading(false);
    }
  };

  const heading = stage === "request"
    ? "Forgot your password?"
    : stage === "verify"
      ? "Check your email"
      : stage === "password"
        ? "Choose a new password"
        : "Password reset";
  const description = stage === "request"
    ? "Enter your administrator email and we’ll send you a verification code."
    : stage === "verify"
      ? `Enter the six-digit code sent to ${email.trim()}.`
      : stage === "password"
        ? "Create a password with at least 10 characters."
        : "Your password has been changed. You can now sign in.";

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-form-section recovery-form-section">
          <h1>{heading}</h1>
          <p>{description}</p>

          {stage === "request" && (
            <form onSubmit={requestCode}>
              <label htmlFor="recovery-email">Email</label>
              <input
                id="recovery-email"
                className="login-input"
                type="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
              {error && <div className="login-error" role="alert">{error}</div>}
              <button className="login-submit" disabled={loading}>
                {loading ? "Sending…" : "Send verification code"}
              </button>
            </form>
          )}

          {stage === "verify" && (
            <form onSubmit={verifyCode}>
              <label htmlFor="recovery-otp">Verification code</label>
              <input
                id="recovery-otp"
                className="login-input recovery-otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                autoComplete="one-time-code"
                autoFocus
                required
              />
              {message && <div className="info-note" role="status"><Mail size={17} /><span>{message}</span></div>}
              {error && <div className="login-error" role="alert">{error}</div>}
              <button className="login-submit" disabled={loading || otp.length !== 6}>
                {loading ? "Verifying…" : "Verify code"}
              </button>
              <div className="recovery-actions">
                <button type="button" className="text-button" disabled={loading} onClick={() => requestCode()}>
                  Resend code
                </button>
                <button type="button" className="text-button" onClick={() => { setStage("request"); setError(""); setMessage(""); }}>
                  Change email
                </button>
              </div>
            </form>
          )}

          {stage === "password" && (
            <form onSubmit={savePassword}>
              <label htmlFor="recovery-password">New password</label>
              <div className="login-password">
                <input
                  id="recovery-password"
                  className="login-input"
                  type={showPassword ? "text" : "password"}
                  minLength={10}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  required
                />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <label htmlFor="recovery-password-confirm">Confirm password</label>
              <input
                id="recovery-password-confirm"
                className="login-input"
                type={showPassword ? "text" : "password"}
                minLength={10}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
              {error && <div className="login-error" role="alert">{error}</div>}
              <button className="login-submit" disabled={loading}>
                {loading ? "Saving…" : "Reset password"}
              </button>
            </form>
          )}

          {stage === "complete" && (
            <button className="login-submit" onClick={() => { window.location.href = "/"; }}>
              Continue to sign in
            </button>
          )}

          {stage !== "complete" && (
            <button type="button" className="recovery-back text-button" onClick={() => { window.location.href = "/"; }}>
              Back to sign in
            </button>
          )}
        </div>
        <aside className="login-visual" aria-label="Secure SignalOps password recovery">
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
          <img className="astronaut-image" src="/images/astro.png" alt="Astronaut floating in space" />
        </aside>
      </section>
    </main>
  );
}

function EditAlertModal({
  alert,
  returnReason,
  onClose,
  onSave,
}: {
  alert: Broadcast;
  returnReason: string | null;
  onClose: () => void;
  onSave: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState(alert.message);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (message.trim().length < 2 || saving) return;
    setSaving(true);
    try {
      await onSave(message.trim());
      onClose();
    } catch {
      // The application-level action displays the API error.
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form className="small-modal" onSubmit={submit}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">RETURNED DRAFT</span>
            <h2>Edit alert message</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body edit-alert-body">
          <label>Alert</label>
          <div className="readonly-alert-title">
            <b>{alert.title}</b>
            <span className={`severity-label ${alert.severity}`}>
              {alert.severity}
            </span>
          </div>
          {returnReason && (
            <div className="return-reason-note">
              <ShieldCheck size={18} />
              <span>
                <b>Requested change</b>
                <small>{returnReason}</small>
              </span>
            </div>
          )}
          <label htmlFor="edit-alert-message">Message</label>
          <textarea
            id="edit-alert-message"
            className="form-input"
            rows={8}
            minLength={2}
            maxLength={2000}
            required
            autoFocus
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="field-hint">
            <span>The audience and delivery policy remain unchanged.</span>
            <b>{message.length}/2000</b>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="text-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || message.trim().length < 2}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RoleEditorModal({
  role,
  permissions,
  onClose,
  onSave,
}: {
  role: ApiRole;
  permissions: ApiPermission[];
  onClose: () => void;
  onSave: (role: ApiRole) => void;
}) {
  const [draft, setDraft] = useState(role);
  const available = permissions.filter(
    (permission) => permission.audience === draft.audience,
  );
  const togglePermission = (code: string) =>
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(code)
        ? current.permissions.filter((item) => item !== code)
        : [...current.permissions, code],
    }));
  return (
    <div className="modal-backdrop">
      <form
        className="small-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.permissions.length) onSave(draft);
        }}
      >
        <div className="modal-header">
          <h2>{role.id ? "Edit organisation role" : "Create organisation role"}</h2>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body">
          <label>Role name</label>
          <input
            className="form-input"
            required
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
          <label>Description</label>
          <textarea
            className="form-input"
            rows={3}
            value={draft.description || ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
          <label>Audience</label>
          <select
            className="form-input"
            disabled={role.is_system}
            value={draft.audience}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                audience: event.target.value as ApiRole["audience"],
                permissions: [],
              }))
            }
          >
            <option value="portal">Portal users</option>
            <option value="employee">Employees</option>
          </select>
          <label>Permissions</label>
          <div className="member-picker">
            {available.map((permission) => (
              <label key={permission.code}>
                <input
                  type="checkbox"
                  checked={draft.permissions.includes(permission.code)}
                  onChange={() => togglePermission(permission.code)}
                />
                <span>
                  <b>{permission.code}</b>
                  <small>{permission.description}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!draft.permissions.length}
          >
            <Check size={16} />
            Save role
          </button>
        </div>
      </form>
    </div>
  );
}

function InvitePortalUserModal({
  roles,
  onClose,
  onSave,
}: {
  roles: ApiRole[];
  onClose: () => void;
  onSave: (value: {
    accountType: "admin";
    fullName: string;
    email: string;
    roleIds: string[];
  }) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [validationError, setValidationError] = useState("");
  const [roleId, setRoleId] = useState(
    roles.find((role) => role.name === "Viewer")?.id || roles[0]?.id || "",
  );
  return (
    <div className="modal-backdrop">
      <form
        className="small-modal"
        onSubmit={(event) => {
          event.preventDefault();
          setValidationError("");
          if (fullName.trim().length < 2) {
            setValidationError("Enter the user’s full name.");
            return;
          }
          if (!isValidEmail(email)) {
            setValidationError("Enter a valid work email address.");
            return;
          }
          onSave({
            accountType: "admin",
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            roleIds: roleId ? [roleId] : [],
          });
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">PORTAL ACCESS</span>
            <h2>Invite administrator</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body">
          <label>Full name</label>
          <input
            className="form-input"
            required
            minLength={2}
            maxLength={160}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
          <label>Work email</label>
          <input
            className="form-input"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label>Portal role</label>
          <select
            className="form-input"
            required
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <div className="info-note">
            <Mail size={18} />
            <span>
              The user will receive an activation email and choose their own
              password.
            </span>
          </div>
          {validationError && (
            <div className="form-error" role="alert">
              {validationError}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!roleId}>
            <Send size={16} />
            Send invitation
          </button>
        </div>
      </form>
    </div>
  );
}

function ProfilePage({
  user,
  organisation,
  onChangePassword,
}: {
  user: CurrentUser;
  organisation: string;
  onChangePassword: () => void;
}) {
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="profile-grid">
      <section className="panel profile-card">
        <div className="profile-hero">
          <span className="profile-hero-avatar">{initials}</span>
          <div>
            <span className="profile-status">
              <i /> Active account
            </span>
            <h2>{user.name}</h2>
            <p>{roleLabel(user)}</p>
          </div>
        </div>
        <div className="profile-details">
          <div className="profile-detail-row">
            <span>
              <CircleUserRound size={18} />
            </span>
            <div>
              <small>Full name</small>
              <b>{user.name}</b>
            </div>
          </div>
          <div className="profile-detail-row">
            <span>
              <Mail size={18} />
            </span>
            <div>
              <small>Email address</small>
              <b>{user.email}</b>
            </div>
          </div>
          <div className="profile-detail-row">
            <span>
              <Building2 size={18} />
            </span>
            <div>
              <small>Organisation</small>
              <b>{organisation}</b>
            </div>
          </div>
          <div className="profile-detail-row">
            <span>
              <ShieldCheck size={18} />
            </span>
            <div>
              <small>Access level</small>
              <b>{roleLabel(user)}</b>
            </div>
          </div>
        </div>
      </section>

      <section className="panel profile-security-card">
        <PanelHeader
          title="Account security"
          subtitle="Password and account recovery"
        />
        <div className="profile-security-content">
          <span className="profile-security-icon">
            <LockKeyhole size={20} />
          </span>
          <div>
            <h3>Password</h3>
            <p>
              Password changes require a six-digit verification code sent to
              your registered email address.
            </p>
          </div>
          <button className="primary-button" onClick={onChangePassword}>
            Change password
          </button>
        </div>
        <div className="profile-security-note">
          <ShieldCheck size={17} />
          <span>
            Your email address identifies your account and cannot currently be
            changed from the portal.
          </span>
        </div>
      </section>
    </div>
  );
}

function SettingsPage({
  canManage,
  onNotify,
}: {
  canManage: boolean;
  onNotify: (message: string) => void;
}) {
  const [preferences, setPreferences] = useState<ApiTenantSettings | null>(
    null,
  );
  const [channels, setChannels] = useState<ApiChannelSetting[]>([]);
  const reload = useCallback(async () => {
    try {
      const value = await api.settings();
      setPreferences(value.preferences);
      setChannels(value.channels);
    } catch (error) {
      onNotify(
        error instanceof SignalOpsApiError
          ? error.message
          : "Unable to load settings",
      );
    }
  }, [onNotify]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const updatePreference = async (value: Record<string, unknown>) => {
    if (!canManage) return;
    try {
      setPreferences(await api.updateSettings(value));
      onNotify("Organisation settings updated");
    } catch (error) {
      onNotify(
        error instanceof SignalOpsApiError
          ? error.message
          : "Unable to update settings",
      );
    }
  };
  return (
    <div className="settings-grid">
      <div className="panel settings-panel">
        <PanelHeader
          title="Delivery channels"
          subtitle="Provider connections for India"
        />
        {channels.map((setting) => (
          <ChannelSetting
            key={setting.id}
            setting={setting}
            canManage={canManage}
            onSaved={reload}
            onNotify={onNotify}
          />
        ))}
        {!channels.length && (
          <EmptyState
            title="No delivery channels"
            text="Channel settings will appear after the organisation loads."
          />
        )}
      </div>
      <div className="panel preferences-panel">
        <PanelHeader
          title="Emergency defaults"
          subtitle="Applied to new critical alerts"
        />
        {preferences ? (
          <>
            <ToggleSetting
              title="Require acknowledgement"
              detail="Recipients must confirm they are safe"
              enabled={preferences.require_critical_acknowledgement}
              disabled={!canManage}
              onToggle={() =>
                canManage &&
                updatePreference({
                  requireCriticalAcknowledgement:
                    !preferences.require_critical_acknowledgement,
                })
              }
            />
            <ToggleSetting
              title="Require critical-alert approval"
              detail="A different authorised user reviews critical alerts"
              enabled={preferences.critical_alert_approval}
              disabled={!canManage}
              onToggle={() =>
                canManage &&
                updatePreference({
                  criticalAlertApproval: !preferences.critical_alert_approval,
                })
              }
            />
            <div className="toggle-setting">
              <div>
                <b>Non-response escalation</b>
                <small>
                  Escalate after {preferences.non_response_escalation_minutes}{" "}
                  minutes
                </small>
              </div>
              <button
                className="filter-button"
                disabled={!canManage}
                onClick={() =>
                  updatePreference({
                    nonResponseEscalationMinutes:
                      preferences.non_response_escalation_minutes === 10
                        ? 15
                        : 10,
                  })
                }
              >
                Change
              </button>
            </div>
            <div className="settings-callout">
              <ShieldCheck size={20} />
              <div>
                <b>Critical messages always bypass quiet hours</b>
                <p>Emergency communication remains available at all times.</p>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="Settings unavailable"
            text="Organisation preferences will appear after they load."
          />
        )}
      </div>
    </div>
  );
}

function ChannelSetting({
  setting,
  canManage,
  onSaved,
  onNotify,
}: {
  setting: ApiChannelSetting;
  canManage: boolean;
  onSaved: () => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [providerValue, setProviderValue] = useState(setting.provider);
  const [senderValue, setSenderValue] = useState(setting.sender_identity || "");
  const Icon =
    setting.channel === "sms"
      ? MessageSquareText
      : setting.channel === "email"
        ? Mail
        : Smartphone;
  const title =
    setting.channel === "push"
      ? "Mobile app push"
      : setting.channel.toUpperCase();
  const unsupported = setting.channel === "sms";
  const save = async (enabled = setting.is_enabled) => {
    if (unsupported) {
      onNotify("SMS is not available until a production provider is integrated");
      return;
    }
    try {
      await api.updateChannel(setting.channel, {
        provider: providerValue,
        senderIdentity: senderValue || undefined,
        configuration: setting.configuration || {},
        isEnabled: enabled,
      });
      await onSaved();
      setEditing(false);
      onNotify(`${title} configuration updated`);
    } catch (error) {
      onNotify(
        error instanceof SignalOpsApiError
          ? error.message
          : "Unable to update channel",
      );
    }
  };
  return (
    <div className="channel-setting">
      <span>
        <Icon size={20} />
      </span>
      <div>
        <b>{title}</b>
        {editing ? (
          <>
            <input
              className="inline-setting-input"
              value={providerValue}
              onChange={(event) => setProviderValue(event.target.value)}
            />
            <input
              className="inline-setting-input"
              value={senderValue}
              onChange={(event) => setSenderValue(event.target.value)}
              placeholder="Sender identity"
            />
          </>
        ) : (
          <>
            <small>{unsupported ? "Provider not integrated" : setting.provider}</small>
            <em>
              {unsupported
                ? "SMS is excluded from alert and template creation"
                : setting.sender_identity || "Sender identity not configured"}
            </em>
          </>
        )}
      </div>
      <button
        className={`connected-pill ${setting.is_enabled && !unsupported ? "" : "disabled"}`}
        disabled={unsupported || !canManage}
        onClick={() => save(!setting.is_enabled)}
      >
        <i />
        {setting.is_enabled && !unsupported ? "Enabled" : "Disabled"}
      </button>
      <button
        className="filter-button"
        disabled={unsupported || !canManage}
        onClick={editing ? () => save() : () => setEditing(true)}
      >
        {editing ? "Save" : "Configure"}
      </button>
    </div>
  );
}

function ToggleSetting({
  title,
  detail,
  enabled = true,
  disabled = false,
  onToggle,
}: {
  title: string;
  detail: string;
  enabled?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  const [internal, setInternal] = useState(enabled);
  const value = onToggle ? enabled : internal;
  return (
    <div className="toggle-setting">
      <div>
        <b>{title}</b>
        <small>{detail}</small>
      </div>
      <button
        className={`toggle ${value ? "on" : ""}`}
        disabled={disabled}
        onClick={() =>
          onToggle ? onToggle() : setInternal((current) => !current)
        }
      >
        <i />
      </button>
    </div>
  );
}

function AlertComposer({
  tenantId,
  facilities,
  recipients,
  groups,
  templates,
  preset,
  canSendImmediately,
  onClose,
  onCreate,
}: {
  tenantId: string;
  facilities: Facility[];
  recipients: Recipient[];
  groups: AudienceGroup[];
  templates: MessageTemplate[];
  preset: MessageTemplate | null;
  canSendImmediately: boolean;
  onClose: () => void;
  onCreate: (
    draft: Omit<
      Broadcast,
      | "id"
      | "tenantId"
      | "createdAt"
      | "createdBy"
      | "sent"
      | "delivered"
      | "retrying"
      | "acknowledged"
      | "failed"
    >,
  ) => void;
}) {
  const tenantFacilities = facilities.filter(
    (item) => item.tenantId === tenantId,
  );
  const activeRecipients = recipients.filter(
    (recipient) => recipient.status === "active",
  );
  const [step, setStep] = useState(1);
  const [templateId, setTemplateId] = useState(
    preset?.id ?? templates[0]?.id ?? "",
  );
  const template =
    templates.find((item) => item.id === templateId) ?? templates[0];
  const [message, setMessage] = useState(
    preset?.message ?? templates[0]?.message ?? "",
  );
  const [audienceType, setAudienceType] = useState<
    "location" | "group" | "person"
  >("location");
  const [facility, setFacility] = useState("All facilities");
  const [building, setBuilding] = useState("Entire facility");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [personId, setPersonId] = useState(activeRecipients[0]?.id ?? "");
  const [approval, setApproval] = useState<
    "Send immediately" | "Request approval" | "Save draft"
  >(canSendImmediately ? "Send immediately" : "Request approval");
  const selectedFacility = tenantFacilities.find(
    (item) => item.name === facility,
  );
  const locationCount =
    facility === "All facilities"
      ? activeRecipients.length
      : building === "Entire facility"
        ? activeRecipients.filter(
            (recipient) => recipient.facilityId === selectedFacility?.id,
          ).length
        : activeRecipients.filter(
            (recipient) =>
              recipient.buildingId ===
              selectedFacility?.buildings.find(
                (item) => item.name === building,
              )?.id,
          ).length;
  const selectedGroup = groups.find((item) => item.id === groupId);
  const activeGroupCount =
    selectedGroup?.memberIds.filter((id) =>
      activeRecipients.some((recipient) => recipient.id === id),
    ).length ?? 0;
  const selectedPerson = activeRecipients.find((item) => item.id === personId);
  const count =
    audienceType === "location"
      ? locationCount
      : audienceType === "group"
        ? activeGroupCount
        : selectedPerson
          ? 1
          : 0;
  const audience =
    audienceType === "location"
      ? facility === "All facilities"
        ? "Everyone across all locations"
        : building === "Entire facility"
          ? `Everyone at ${facility}`
          : `Everyone in ${building}`
      : audienceType === "group"
        ? (selectedGroup?.name ?? "Selected group")
        : (selectedPerson?.name ?? "Selected person");
  const targetLocation =
    audienceType === "location"
      ? building === "Entire facility"
        ? facility
        : `${facility} · ${building}`
      : audienceType === "person"
        ? `${selectedPerson?.facility ?? ""} · ${selectedPerson?.building ?? ""}`
        : "Multiple locations";
  const canContinue = Boolean(template && message.trim());
  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    const next = templates.find((item) => item.id === id);
    if (next) setMessage(next.message);
  };

  if (!template)
    return (
      <div className="modal-backdrop">
        <div className="small-modal">
          <div className="modal-header">
            <h2>No templates available</h2>
            <button onClick={onClose}>
              <X size={21} />
            </button>
          </div>
          <div className="small-modal-body">
            <p>Create an alert template before sending an alert.</p>
          </div>
        </div>
      </div>
    );

  return (
    <div className="modal-backdrop">
      <div className="composer-modal">
        <div className="modal-header">
          <div>
            <span className="eyebrow">NEW BROADCAST</span>
            <h2>Create an alert</h2>
          </div>
          <button onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="stepper">
          <span className={step >= 1 ? "active" : ""}>
            <i>1</i>Message
          </span>
          <em />
          <span className={step >= 2 ? "active" : ""}>
            <i>2</i>Audience
          </span>
          <em />
          <span className={step >= 3 ? "active" : ""}>
            <i>3</i>Review & send
          </span>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <div className="form-section">
              <label>Alert type / template</label>
              <select
                className="form-input"
                value={template.id}
                onChange={(event) => chooseTemplate(event.target.value)}
              >
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.category}
                  </option>
                ))}
              </select>
              <div className="template-policy">
                <span className={`severity-label ${template.severity}`}>
                  {template.severity}
                </span>
                <ChannelPills channels={template.channels} />
                <small>
                  {template.requiresAcknowledgement
                    ? "Acknowledgement required"
                    : "Acknowledgement not required"}
                </small>
              </div>
              <label>Message</label>
              <textarea
                className="form-input"
                rows={7}
                maxLength={480}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Complete the prepared message with the incident details and instructions."
              />
              <div className="field-hint">
                <span>
                  Replace template variables and keep instructions
                  action-oriented.
                </span>
                <b>{message.length}/480</b>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="form-section">
              <label>Target audience</label>
              <div className="audience-type-options">
                <button
                  className={audienceType === "location" ? "selected" : ""}
                  onClick={() => setAudienceType("location")}
                >
                  <MapPin size={19} />
                  <b>Location</b>
                  <small>Facility or building</small>
                </button>
                <button
                  className={audienceType === "group" ? "selected" : ""}
                  onClick={() => setAudienceType("group")}
                >
                  <UsersRound size={19} />
                  <b>Group</b>
                  <small>Saved group</small>
                </button>
                <button
                  className={audienceType === "person" ? "selected" : ""}
                  onClick={() => setAudienceType("person")}
                >
                  <CircleUserRound size={19} />
                  <b>Individual</b>
                  <small>Single person</small>
                </button>
              </div>
              {audienceType === "location" && (
                <div className="form-grid">
                  <div>
                    <label>Facility</label>
                    <select
                      className="form-input"
                      value={facility}
                      onChange={(event) => {
                        setFacility(event.target.value);
                        setBuilding("Entire facility");
                      }}
                    >
                      <option>All facilities</option>
                      {tenantFacilities.map((item) => (
                        <option key={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Building / area</label>
                    <select
                      className="form-input"
                      disabled={!selectedFacility}
                      value={building}
                      onChange={(event) => setBuilding(event.target.value)}
                    >
                      <option>Entire facility</option>
                      {selectedFacility?.buildings.map((item) => (
                        <option key={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {audienceType === "group" && (
                <div>
                  <label>Saved group</label>
                  <select
                    className="form-input"
                    value={groupId}
                    onChange={(event) => setGroupId(event.target.value)}
                  >
                    {groups.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ·{" "}
                        {
                          item.memberIds.filter((id) =>
                            activeRecipients.some(
                              (recipient) => recipient.id === id,
                            ),
                          ).length
                        } active members
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {audienceType === "person" && (
                <div>
                  <label>Person</label>
                  <select
                    className="form-input"
                    value={personId}
                    onChange={(event) => setPersonId(event.target.value)}
                  >
                    {!activeRecipients.length && (
                      <option value="">No active employees available</option>
                    )}
                    {activeRecipients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.facility} / {item.building}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="audience-summary">
                <Users size={21} />
                <div>
                  <b>
                    {count} recipient{count === 1 ? "" : "s"} selected
                  </b>
                  <small>{audience}</small>
                </div>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="review-layout">
              <div>
                <div className={`review-alert ${template.severity}`}>
                  <span className={`severity-label ${template.severity}`}>
                    {template.severity}
                  </span>
                  <h3>{template.title}</h3>
                  <p>{message}</p>
                </div>
                <dl className="review-details">
                  <div>
                    <dt>Recipients</dt>
                    <dd>
                      {count} people · {audience}
                    </dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{targetLocation}</dd>
                  </div>
                  <div>
                    <dt>Channels</dt>
                    <dd>
                      <ChannelPills channels={template.channels} />
                    </dd>
                  </div>
                  <div>
                    <dt>Acknowledgement</dt>
                    <dd>
                      {template.requiresAcknowledgement
                        ? "Required"
                        : "Not required"}
                    </dd>
                  </div>
                </dl>
              </div>
              <aside>
                <label>Release policy</label>
                {canSendImmediately && (
                  <button
                    className={`approval-option ${approval === "Send immediately" ? "selected" : ""}`}
                    onClick={() => setApproval("Send immediately")}
                  >
                    <i>
                      {approval === "Send immediately" && <Check size={14} />}
                    </i>
                    <span>
                      <b>Send immediately</b>
                      <small>Release now using your send permission</small>
                    </span>
                  </button>
                )}
                <button
                  className={`approval-option ${approval === "Request approval" ? "selected" : ""}`}
                  onClick={() => setApproval("Request approval")}
                >
                  <i>
                    {approval === "Request approval" && <Check size={14} />}
                  </i>
                  <span>
                    <b>Request approval</b>
                    <small>Notify another controller to review</small>
                  </span>
                </button>
                <button
                  className={`approval-option ${approval === "Save draft" ? "selected" : ""}`}
                  onClick={() => setApproval("Save draft")}
                >
                  <i>
                    {approval === "Save draft" && <Check size={14} />}
                  </i>
                  <span>
                    <b>Save draft</b>
                    <small>Keep the recipient snapshot without releasing it</small>
                  </span>
                </button>
              </aside>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            className="text-button"
            onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 3 ? (
            <button
              className="primary-button"
              disabled={!canContinue || (step === 2 && count === 0)}
              onClick={() => setStep((value) => value + 1)}
            >
              Continue <ChevronRight size={17} />
            </button>
          ) : (
            <button
              className={`send-button ${template.severity}`}
              onClick={() => {
                const selectedBuilding = selectedFacility?.buildings.find(
                  (item) => item.name === building,
                );
                const apiAudienceType =
                  audienceType === "group"
                    ? "group"
                    : audienceType === "person"
                      ? "person"
                      : facility === "All facilities"
                        ? "organisation"
                        : building === "Entire facility"
                          ? "facility"
                          : "building";
                const referenceId =
                  apiAudienceType === "organisation"
                    ? null
                    : apiAudienceType === "group"
                      ? groupId
                      : apiAudienceType === "person"
                        ? personId
                        : apiAudienceType === "facility"
                          ? selectedFacility?.id || null
                          : selectedBuilding?.id || null;
                onCreate({
                  title: template.title,
                  message,
                  severity: template.severity,
                  facility: targetLocation,
                  audience,
                  audienceType: apiAudienceType,
                  audienceReferenceId: referenceId,
                  channels: template.channels,
                  recipients: count,
                  requiresAcknowledgement: template.requiresAcknowledgement,
                  status:
                    approval === "Send immediately"
                      ? "active"
                      : approval === "Request approval"
                        ? "pending_approval"
                        : "draft",
                });
              }}
            >
              {approval === "Send immediately" ? (
                <>
                  <Send size={17} />
                  Send alert now
                </>
              ) : approval === "Request approval" ? (
                <>
                  <Clock3 size={17} />
                  Submit for approval
                </>
              ) : (
                <>
                  <FileText size={17} />
                  Save draft
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddPersonModal({
  tenantId,
  facilities,
  departments,
  roles,
  onClose,
  onAdd,
}: {
  tenantId: string;
  facilities: Facility[];
  departments: Department[];
  roles: ApiRole[];
  onClose: () => void;
  onAdd: (person: Recipient) => void;
}) {
  const tenantFacilities = facilities.filter(
    (item) => item.tenantId === tenantId,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [validationError, setValidationError] = useState("");
  const roleId =
    roles.find(
      (item) => item.audience === "employee" && item.name === "Employee",
    )?.id ?? "";
  const [department, setDepartment] = useState(departments[0]?.name ?? "");
  const [facility, setFacility] = useState(tenantFacilities[0]?.name ?? "");
  const [building, setBuilding] = useState(
    tenantFacilities[0]?.buildings[0]?.name ?? "",
  );
  const selectedFacility = tenantFacilities.find(
    (item) => item.name === facility,
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setValidationError("");
    const normalisedPhone = normaliseIndianMobile(phone);
    if (name.trim().length < 2) {
      setValidationError("Enter the employee’s full name.");
      return;
    }
    if (!isValidEmail(email)) {
      setValidationError("Enter a valid work email address.");
      return;
    }
    if (!isValidIndianMobile(phone)) {
      setValidationError(
        "Enter a valid Indian mobile number, for example +91 98765 43210.",
      );
      return;
    }
    if (!roleId) {
      setValidationError("The system Employee role is unavailable.");
      return;
    }
    const initials = name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const departmentId = departments.find(
      (item) => item.name === department,
    )?.id;
    const facilityId = selectedFacility?.id;
    const buildingId = selectedFacility?.buildings.find(
      (item) => item.name === building,
    )?.id;
    onAdd({
      id: crypto.randomUUID(),
      tenantId,
      name: name.trim(),
      initials,
      email: email.trim().toLowerCase(),
      phone: normalisedPhone,
      role: role.trim(),
      department,
      facility,
      building,
      status: "invited",
      accountType: "employee",
      departmentId,
      facilityId,
      buildingId,
      roleIds: roleId ? [roleId] : [],
    });
  };
  return (
    <div className="modal-backdrop">
      <form className="small-modal" onSubmit={submit}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">DIRECTORY</span>
            <h2>Add a recipient</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body">
          <div className="form-grid">
            <div>
              <label>Full name</label>
              <input
                className="form-input"
                required
                minLength={2}
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Arun Mehta"
              />
            </div>
            <div>
              <label>Work email</label>
              <input
                className="form-input"
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.in"
              />
            </div>
            <div>
              <label>Mobile number</label>
              <input
                className="form-input"
                type="tel"
                inputMode="tel"
                required
                maxLength={18}
                title="Enter a 10-digit Indian mobile number with +91"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                onBlur={() => setPhone(normaliseIndianMobile(phone))}
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label>Job role</label>
              <input
                className="form-input"
                required
                maxLength={120}
                value={role}
                onChange={(event) => setRole(event.target.value)}
                placeholder="e.g. Safety officer"
              />
            </div>
            <div>
              <label>Department</label>
              <select
                className="form-input"
                required
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
              >
                {departments.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label>App role</label>
              <div className="form-input readonly-form-field" aria-readonly="true">
                <span>Employee</span>
                <small>Read only</small>
              </div>
            </div>
            <div>
              <label>Facility</label>
              <select
                className="form-input"
                value={facility}
                onChange={(event) => {
                  setFacility(event.target.value);
                  setBuilding(
                    tenantFacilities.find(
                      (item) => item.name === event.target.value,
                    )?.buildings[0]?.name ?? "",
                  );
                }}
              >
                {tenantFacilities.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Building / area</label>
              <select
                className="form-input"
                value={building}
                onChange={(event) => setBuilding(event.target.value)}
              >
                {selectedFacility?.buildings.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="info-note">
            <Smartphone size={19} />
            <span>
              The recipient will receive a mobile app invitation after being
              added.
            </span>
          </div>
          {validationError && (
            <div className="form-error" role="alert">
              {validationError}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={!roleId}>
            <Plus size={17} />
            Add recipient
          </button>
        </div>
      </form>
    </div>
  );
}

function AddDepartmentModal({
  tenantId,
  onClose,
  onAdd,
}: {
  tenantId: string;
  onClose: () => void;
  onAdd: (department: Department) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="modal-backdrop">
      <form
        className="small-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd({
            id: crypto.randomUUID(),
            tenantId,
            name: name.trim(),
            description: description.trim(),
          });
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">DIRECTORY</span>
            <h2>Add a department</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body">
          <label>Department name</label>
          <input
            autoFocus
            className="form-input"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Security"
          />
          <label>Description</label>
          <textarea
            className="form-input"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this department is responsible for"
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <Plus size={17} />
            Add department
          </button>
        </div>
      </form>
    </div>
  );
}

function DepartmentEditorModal({
  department,
  onClose,
  onSave,
  onDelete,
}: {
  department: Department;
  onClose: () => void;
  onSave: (department: Department) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(department.name);
  const [description, setDescription] = useState(department.description);
  return (
    <div className="modal-backdrop">
      <form
        className="small-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            ...department,
            name: name.trim(),
            description: description.trim(),
          });
        }}
      >
        <div className="modal-header">
          <h2>Edit department</h2>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body">
          <label>Name</label>
          <input
            className="form-input"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label>Description</label>
          <textarea
            className="form-input"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="danger-text-button"
            onClick={onDelete}
          >
            Delete department
          </button>
          <button className="primary-button" type="submit">
            <Check size={16} />
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

function GroupEditorModal({
  group,
  people,
  onClose,
  onSave,
  onDelete,
}: {
  group: AudienceGroup;
  people: Recipient[];
  onClose: () => void;
  onSave: (group: AudienceGroup) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [memberIds, setMemberIds] = useState(group.memberIds);
  const [search, setSearch] = useState("");
  const visible = people.filter((person) =>
    `${person.name} ${person.department} ${person.facility}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="modal-backdrop">
      <form
        className="small-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...group, name, description, memberIds });
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">AUDIENCE</span>
            <h2>Manage group</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body">
          <div className="form-grid">
            <div>
              <label>Group name</label>
              <input
                className="form-input"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <label>Description</label>
              <input
                className="form-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <label>Members ({memberIds.length})</label>
          <div className="search-box modal-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search people"
            />
          </div>
          <div className="member-picker">
            {visible.map((person) => (
              <label key={person.id}>
                <input
                  type="checkbox"
                  checked={memberIds.includes(person.id)}
                  onChange={() =>
                    setMemberIds((current) =>
                      current.includes(person.id)
                        ? current.filter((id) => id !== person.id)
                        : [...current, person.id],
                    )
                  }
                />
                <span className="person-avatar">{person.initials}</span>
                <span>
                  <b>{person.name}</b>
                  <small>
                    {person.department} · {person.facility}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="danger-text-button"
            onClick={onDelete}
          >
            Delete group
          </button>
          <button className="primary-button" type="submit">
            <Check size={16} />
            Save group
          </button>
        </div>
      </form>
    </div>
  );
}

function PersonEditorModal({
  person,
  departments,
  facilities,
  onClose,
  onSave,
  onDelete,
}: {
  person: Recipient;
  departments: Department[];
  facilities: Facility[];
  onClose: () => void;
  onSave: (person: Recipient) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(person);
  const [validationError, setValidationError] = useState("");
  const selectedFacility = facilities.find(
    (item) => item.name === draft.facility,
  );
  const field = (key: keyof Recipient, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="modal-backdrop">
      <form
        className="small-modal"
        onSubmit={(event) => {
          event.preventDefault();
          setValidationError("");
          if (draft.name.trim().length < 2) {
            setValidationError("Enter the employee’s full name.");
            return;
          }
          if (!isValidEmail(draft.email)) {
            setValidationError("Enter a valid work email address.");
            return;
          }
          if (!isValidIndianMobile(draft.phone)) {
            setValidationError(
              "Enter a valid Indian mobile number, for example +91 98765 43210.",
            );
            return;
          }
          onSave({
            ...draft,
            name: draft.name.trim(),
            email: draft.email.trim().toLowerCase(),
            phone: normaliseIndianMobile(draft.phone),
            role: draft.role.trim(),
            initials: draft.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase(),
          });
        }}
      >
        <div className="modal-header">
          <h2>Edit person</h2>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body">
          <div className="form-grid">
            <div>
              <label>Name</label>
              <input
                className="form-input"
                required
                minLength={2}
                maxLength={160}
                value={draft.name}
                onChange={(event) => field("name", event.target.value)}
              />
            </div>
            <div>
              <label>Email</label>
              <input
                className="form-input"
                type="email"
                required
                maxLength={254}
                value={draft.email}
                onChange={(event) => field("email", event.target.value)}
              />
            </div>
            <div>
              <label>Phone</label>
              <input
                className="form-input"
                type="tel"
                inputMode="tel"
                required
                maxLength={18}
                title="Enter a 10-digit Indian mobile number with +91"
                value={draft.phone}
                onChange={(event) => field("phone", event.target.value)}
                onBlur={() => field("phone", normaliseIndianMobile(draft.phone))}
              />
            </div>
            <div>
              <label>Role</label>
              <input
                className="form-input"
                required
                maxLength={120}
                value={draft.role}
                onChange={(event) => field("role", event.target.value)}
              />
            </div>
            <div>
              <label>Department</label>
              <select
                className="form-input"
                value={draft.department}
                onChange={(event) => field("department", event.target.value)}
              >
                {departments.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Status</label>
              <select
                className="form-input"
                value={draft.status}
                onChange={(event) => field("status", event.target.value)}
              >
                <option value="invited">Invited</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <div>
              <label>App role</label>
              <div className="form-input readonly-form-field" aria-readonly="true">
                <span>Employee</span>
                <small>Read only</small>
              </div>
            </div>
            <div>
              <label>Facility</label>
              <select
                className="form-input"
                value={draft.facility}
                onChange={(event) => {
                  const facility = facilities.find(
                    (item) => item.name === event.target.value,
                  );
                  setDraft((current) => ({
                    ...current,
                    facility: event.target.value,
                    building: facility?.buildings[0]?.name ?? "",
                  }));
                }}
              >
                {facilities.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Building</label>
              <select
                className="form-input"
                value={draft.building}
                onChange={(event) => field("building", event.target.value)}
              >
                {selectedFacility?.buildings.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
          </div>
          {validationError && (
            <div className="form-error" role="alert">
              {validationError}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="danger-text-button"
            onClick={onDelete}
          >
            Disable person
          </button>
          <button className="primary-button" type="submit">
            <Check size={16} />
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

function FacilityEditorModal({
  tenantId,
  facility,
  onClose,
  onSave,
  onDelete,
}: {
  tenantId: string;
  facility?: Facility;
  onClose: () => void;
  onSave: (facility: Facility) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(facility?.name ?? "");
  const [city, setCity] = useState(facility?.city ?? "");
  const [address, setAddress] = useState(facility?.address ?? "");
  const [buildings, setBuildings] = useState<Facility["buildings"]>(
    facility?.buildings ?? [],
  );
  const updateBuilding = (
    id: string,
    patch: Partial<Facility["buildings"][number]>,
  ) =>
    setBuildings((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const addBuilding = () => {
    const index = buildings.length;
    setBuildings((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: "",
        people: 0,
        x: 8 + (index % 3) * 30,
        y: 12 + Math.floor(index / 3) * 32,
        w: 24,
        h: 22,
      },
    ]);
  };
  return (
    <div className="modal-backdrop">
      <form
        className="composer-modal facility-editor"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            id: facility?.id ?? crypto.randomUUID(),
            tenantId,
            name,
            city,
            address,
            people: buildings.reduce((sum, item) => sum + item.people, 0),
            buildings,
          });
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">LOCATION</span>
            <h2>{facility ? "Edit facility" : "Add facility"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div>
              <label>Facility name</label>
              <input
                className="form-input"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <label>City / region</label>
              <input
                className="form-input"
                required
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </div>
          </div>
          <label>Address</label>
          <input
            className="form-input"
            required
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <div className="section-heading">
            <div>
              <b>Buildings and areas</b>
              <small>Employee totals come from directory assignments.</small>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={addBuilding}
            >
              <Plus size={16} />
              Add building
            </button>
          </div>
          <div className="building-editor-list">
            {buildings.map((building) => (
              <div key={building.id}>
                <input
                  className="form-input"
                  aria-label="Building name"
                  required
                  value={building.name}
                  onChange={(event) =>
                    updateBuilding(building.id, { name: event.target.value })
                  }
                />
                <span className="building-assignment-count">
                  {building.people} assigned employees
                </span>
                <button
                  type="button"
                  title="Delete building"
                  onClick={() =>
                    setBuildings((current) =>
                      current.filter((item) => item.id !== building.id),
                    )
                  }
                >
                  <X size={17} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          {onDelete ? (
            <button
              type="button"
              className="danger-text-button"
              onClick={onDelete}
            >
              Delete facility
            </button>
          ) : (
            <button type="button" className="text-button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="primary-button" type="submit">
            <Check size={16} />
            Save facility
          </button>
        </div>
      </form>
    </div>
  );
}

function TemplateEditorModal({
  tenantId,
  template,
  categories,
  onCategoriesChange,
  onClose,
  onSave,
  onDelete,
}: {
  tenantId: string;
  template?: MessageTemplate;
  categories: string[];
  onCategoriesChange: (categories: string[]) => void;
  onClose: () => void;
  onSave: (template: MessageTemplate) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(template?.title ?? "");
  const [category, setCategory] = useState(
    template?.category ?? categories[0] ?? "",
  );
  const [newCategory, setNewCategory] = useState("");
  const [severity, setSeverity] = useState<MessageTemplate["severity"]>(
    template?.severity ?? "critical",
  );
  const [message, setMessage] = useState(template?.message ?? "");
  const [channels, setChannels] = useState<Channel[]>(
    template?.channels.filter((channel) => channel !== "sms") ?? [
      "email",
      "android",
    ],
  );
  const [ack, setAck] = useState(template?.requiresAcknowledgement ?? true);
  const toggle = (channel: Channel) =>
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  const addCategory = () => {
    const value = newCategory.trim();
    if (!value) return;
    if (!categories.includes(value)) onCategoriesChange([...categories, value]);
    setCategory(value);
    setNewCategory("");
  };
  return (
    <div className="modal-backdrop">
      <form
        className="small-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (!channels.length || !category.trim()) return;
          onSave({
            id: template?.id ?? crypto.randomUUID(),
            tenantId,
            title,
            category,
            severity,
            message,
            channels,
            requiresAcknowledgement: ack,
          });
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">PREPAREDNESS</span>
            <h2>{template ? "Edit template" : "Create template"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="small-modal-body">
          <div className="form-grid">
            <div>
              <label>Template name</label>
              <input
                className="form-input"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div>
              <label>Category</label>
              <select
                className="form-input"
                required
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {!categories.length && (
                  <option value="" disabled>
                    Add a category first
                  </option>
                )}
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Alert level</label>
              <select
                className="form-input"
                value={severity}
                onChange={(event) => {
                  const value = event.target
                    .value as MessageTemplate["severity"];
                  setSeverity(value);
                  if (value !== "critical") setAck(false);
                }}
              >
                <option value="critical">Critical</option>
                <option value="warning">Advisory</option>
                <option value="info">Information</option>
              </select>
            </div>
            <div>
              <label>Add category</label>
              <div className="inline-field">
                <input
                  className="form-input"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  placeholder="New category"
                />
                <button type="button" onClick={addCategory}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
          <label>Prepared message</label>
          <textarea
            className="form-input"
            required
            rows={5}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Use variables such as {{location}} where needed."
          />
          <label>Delivery channels</label>
          <div className="channel-options">
            {(["email", "android"] as Channel[]).map((channel) => {
              const Icon = channelIcon[channel];
              return (
                <button
                  type="button"
                  key={channel}
                  className={channels.includes(channel) ? "selected" : ""}
                  onClick={() => toggle(channel)}
                >
                  <span>
                    <Icon size={19} />
                  </span>
                  <div>
                    <b>{channelLabel[channel]}</b>
                  </div>
                  <i>{channels.includes(channel) && <Check size={14} />}</i>
                </button>
              );
            })}
          </div>
          <ToggleSetting
            title="Require acknowledgement"
            detail="Recipients must confirm receipt or safety"
            enabled={ack}
            onToggle={() => setAck((value) => !value)}
          />
        </div>
        <div className="modal-footer">
          {onDelete ? (
            <button
              type="button"
              className="danger-text-button"
              onClick={onDelete}
            >
              Delete template
            </button>
          ) : (
            <button type="button" className="text-button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            className="primary-button"
            disabled={!channels.length || !category.trim()}
            type="submit"
          >
            <Check size={17} />
            Save template
          </button>
        </div>
      </form>
    </div>
  );
}

function ChannelPills({
  channels,
  compact = false,
}: {
  channels: Channel[];
  compact?: boolean;
}) {
  return (
    <span className={`channel-pills ${compact ? "compact" : ""}`}>
      {channels.map((channel) => {
        const Icon = channelIcon[channel];
        return (
          <span key={channel} title={channelLabel[channel]}>
            <Icon size={compact ? 14 : 15} />
            {!compact && channelLabel[channel]}
          </span>
        );
      })}
    </span>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Inbox size={22} />
      </span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
    </div>
  );
}

export default App;

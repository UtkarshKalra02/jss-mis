import {
  BarChart3,
  Banknote,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  MessageSquareQuote,
  Package,
  PenTool,
  Receipt,
  Scale,
  Settings,
  Stamp,
  Target,
  Truck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { Resource } from "@/auth/roles";

/**
 * Navigation, derived from the role matrix.
 *
 * Every entry is keyed by a Resource, so the sidebar cannot show a link the
 * matrix does not grant — the visible nav and the server-side guard read the
 * same source. Adding a screen means adding a Resource in roles.ts and an
 * entry here; there is no third place to forget.
 *
 * `phase` marks when the screen actually gets built. Anything past Phase 1 is
 * rendered dimmed and inert rather than hidden: the shape of the finished
 * system is useful to see, and a dead link that 404s is worse than a visibly
 * unfinished one.
 */
export type NavItem = {
  resource: Resource;
  label: string;
  href: string;
  icon: LucideIcon;
  phase: 1 | 2 | 3 | 4 | 5 | 6;
};

export type NavGroup = {
  /** Null renders without a heading — used for the single top item. */
  heading: string | null;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    heading: null,
    items: [
      {
        resource: "dashboard",
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        phase: 1,
      },
    ],
  },
  {
    heading: "Orders",
    items: [
      {
        resource: "enquiry",
        label: "Enquiries",
        href: "/enquiries",
        icon: MessageSquareQuote,
        phase: 3,
      },
      {
        resource: "quotation",
        label: "Quotations",
        href: "/quotations",
        icon: FileText,
        phase: 3,
      },
      {
        resource: "purchase_order",
        label: "Purchase Orders",
        href: "/purchase-orders",
        icon: ClipboardList,
        phase: 2,
      },
      {
        resource: "import",
        label: "Import from Excel",
        href: "/purchase-orders/import",
        icon: FileSpreadsheet,
        phase: 2,
      },
      { resource: "design", label: "Designs", href: "/designs", icon: PenTool, phase: 2 },
      /**
       * Beside Designs rather than under Production: Punit owns the register
       * (I9), a tool is nearly always made FOR a design, and the two screens
       * link to each other constantly.
       */
      { resource: "tooling", label: "Tooling", href: "/tooling", icon: Stamp, phase: 1 },
      {
        resource: "item_tracker",
        label: "Item Tracker",
        href: "/items",
        icon: Package,
        phase: 2,
      },
    ],
  },
  {
    heading: "Production",
    items: [
      {
        resource: "job_planning",
        label: "Job Planning",
        href: "/planning",
        icon: CalendarDays,
        phase: 4,
      },
      {
        resource: "stage_update",
        label: "Stage Update",
        href: "/stage-update",
        icon: Workflow,
        phase: 2,
      },
      { resource: "dispatch", label: "Dispatch", href: "/dispatch", icon: Truck, phase: 2 },
    ],
  },
  {
    heading: "Accounts",
    items: [
      { resource: "invoice", label: "Invoices", href: "/invoices", icon: Receipt, phase: 5 },
      { resource: "receipt", label: "Receipts", href: "/receipts", icon: Banknote, phase: 5 },
      { resource: "ar_ledger", label: "AR Ledger", href: "/ar", icon: Scale, phase: 5 },
    ],
  },
  {
    /**
     * BMP week 9, not spec section 6. This is the first module in the system
     * that the v1 spec does not describe at all — see section G of
     * DECISIONS.md. It is marked phase 1 because it is built and reachable now,
     * and `phase` here means "when does this screen exist", not "which spec
     * phase owns it".
     */
    heading: "Accountability",
    items: [
      {
        resource: "delegation",
        label: "My Tasks",
        href: "/delegation",
        icon: ClipboardCheck,
        phase: 1,
      },
      {
        resource: "delegation_scorecard",
        label: "Scorecard",
        href: "/delegation/scorecard",
        icon: Target,
        phase: 1,
      },
    ],
  },
  {
    heading: "Insight",
    items: [
      { resource: "reports", label: "Reports", href: "/reports", icon: BarChart3, phase: 6 },
    ],
  },
  {
    heading: "Setup",
    items: [
      { resource: "client", label: "Clients", href: "/clients", icon: Building2, phase: 1 },
      { resource: "admin", label: "Admin", href: "/admin", icon: Settings, phase: 1 },
    ],
  },
];

/**
 * Screens that exist right now. Kept separate from `phase` because a screen
 * lands mid-phase: Clients is Phase 1 but arrives two commits after the shell,
 * and linking to it early would 404.
 */
export const BUILT: ReadonlySet<Resource> = new Set<Resource>([
  "dashboard",
  "stage_update",
  "admin",
  "client",
  "design",
  "purchase_order",
  "item_tracker",
  "dispatch",
  "import",
  "delegation",
  "delegation_scorecard",
  "tooling",
]);

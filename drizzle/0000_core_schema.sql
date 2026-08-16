CREATE TYPE "public"."approval_status" AS ENUM('Pending', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('INSERT', 'UPDATE', 'SOFT_DELETE', 'RESTORE');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('New', 'Repeat');--> statement-breakpoint
CREATE TYPE "public"."committed_date_basis" AS ENUM('Manual', 'Calculated');--> statement-breakpoint
CREATE TYPE "public"."dieplate_status" AS ENUM('Pending', 'Ordered', 'Received', 'Old', 'NA');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('Draft', 'Dispatched', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."enquiry_status" AS ENUM('Open', 'Quoted', 'Won', 'Lost');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('Draft', 'Raised', 'Partially Paid', 'Paid', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_card_status" AS ENUM('Planned', 'In Process', 'On Hold', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('New', 'Repeat');--> statement-breakpoint
CREATE TYPE "public"."po_item_status" AS ENUM('Open', 'Closed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('Normal', 'High', 'Urgent');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('Open', 'Partially Dispatched', 'Closed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('Sent', 'Accepted', 'Rejected', 'Expired');--> statement-breakpoint
CREATE TYPE "public"."receipt_mode" AS ENUM('NEFT', 'RTGS', 'Cheque', 'Cash', 'UPI', 'Other');--> statement-breakpoint
CREATE TYPE "public"."stage_applies_to" AS ENUM('All', 'New', 'Repeat');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'ORDER_DESK', 'PLANNER', 'ACCOUNTS', 'FLOOR', 'OWNER');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" "user_role" NOT NULL,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"description" text,
	CONSTRAINT "app_setting_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"pincode" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"credit_limit" numeric(14, 2),
	"client_type" "client_type" DEFAULT 'New' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"prefix" text NOT NULL,
	"fy_start" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"padding" integer DEFAULT 4 NOT NULL,
	CONSTRAINT "number_series_prefix_fy_key" UNIQUE("prefix","fy_start")
);
--> statement-breakpoint
CREATE TABLE "stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"applies_to" "stage_applies_to" DEFAULT 'All' NOT NULL,
	"target_hours" numeric(6, 2),
	"target_hours_verified" boolean DEFAULT false NOT NULL,
	"colour" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "stage_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "enquiry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"enquiry_no" text NOT NULL,
	"client_id" uuid NOT NULL,
	"enquiry_date" date NOT NULL,
	"description" text,
	"expected_qty" integer,
	"status" "enquiry_status" DEFAULT 'Open' NOT NULL,
	"lost_reason" text,
	"closed_at" date,
	"owner_user_id" uuid,
	CONSTRAINT "enquiry_lost_reason_required" CHECK ("enquiry"."status" <> 'Lost' or ("enquiry"."lost_reason" is not null and length(trim("enquiry"."lost_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "quotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"quote_no" text NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"quote_date" date NOT NULL,
	"valid_until" date,
	"rate_per_unit" numeric(14, 2),
	"total_value" numeric(14, 2),
	"status" "quotation_status" DEFAULT 'Sent' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "design" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"design_code" text NOT NULL,
	"client_id" uuid NOT NULL,
	"job_name" text NOT NULL,
	"job_size" text,
	"gsm" text,
	"paper_type" text,
	"print_type" text,
	"no_of_colours" text,
	"die_id" text,
	"plate_id" text,
	"die_status" "dieplate_status" DEFAULT 'NA' NOT NULL,
	"plate_status" "dieplate_status" DEFAULT 'NA' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'Pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"artwork_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "design_approval_complete" CHECK ("design"."approval_status" <> 'Approved' or ("design"."approved_at" is not null and "design"."approved_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "design_process" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"design_id" uuid NOT NULL,
	"stage_code" text NOT NULL,
	"sequence" integer,
	CONSTRAINT "design_process_design_stage_key" UNIQUE("design_id","stage_code")
);
--> statement-breakpoint
CREATE TABLE "po_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"item_code" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"design_id" uuid,
	"item_name" text NOT NULL,
	"ordered_qty" integer NOT NULL,
	"rate" numeric(14, 2),
	"committed_date" date NOT NULL,
	"committed_date_basis" "committed_date_basis" DEFAULT 'Manual' NOT NULL,
	"job_type" "job_type" DEFAULT 'New' NOT NULL,
	"priority" "priority" DEFAULT 'Normal' NOT NULL,
	"status" "po_item_status" DEFAULT 'Open' NOT NULL,
	"remarks" text,
	CONSTRAINT "po_item_ordered_qty_positive" CHECK ("po_item"."ordered_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"po_no" text,
	"internal_no" text NOT NULL,
	"client_id" uuid NOT NULL,
	"po_date" date NOT NULL,
	"enquiry_id" uuid,
	"file_url" text,
	"status" "purchase_order_status" DEFAULT 'Open' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "job_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"jc_no" text NOT NULL,
	"po_item_id" uuid NOT NULL,
	"planned_qty" integer,
	"planned_date" date,
	"status" "job_card_status" DEFAULT 'Planned' NOT NULL,
	"hold_reason" text,
	"notes" text,
	CONSTRAINT "job_card_planned_qty_positive" CHECK ("job_card"."planned_qty" is null or "job_card"."planned_qty" > 0),
	CONSTRAINT "job_card_hold_reason_required" CHECK ("job_card"."status" <> 'On Hold' or ("job_card"."hold_reason" is not null and length(trim("job_card"."hold_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "stage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_item_id" uuid NOT NULL,
	"job_card_id" uuid,
	"stage_code" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"entered_by" uuid,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"challan_no" text NOT NULL,
	"client_id" uuid NOT NULL,
	"dispatch_date" date NOT NULL,
	"vehicle_no" text,
	"transporter" text,
	"eway_bill_no" text,
	"status" "dispatch_status" DEFAULT 'Draft' NOT NULL,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "dispatch_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"dispatch_id" uuid NOT NULL,
	"po_item_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(14, 2),
	CONSTRAINT "dispatch_line_qty_positive" CHECK ("dispatch_line"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"invoice_no" text NOT NULL,
	"client_id" uuid NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"taxable_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" "invoice_status" DEFAULT 'Draft' NOT NULL,
	"busy_synced" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "invoice_total_non_negative" CHECK ("invoice"."total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"dispatch_line_id" uuid NOT NULL,
	"description" text,
	"qty" integer NOT NULL,
	"rate" numeric(14, 2),
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "invoice_line_qty_positive" CHECK ("invoice_line"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"receipt_no" text NOT NULL,
	"client_id" uuid NOT NULL,
	"receipt_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"mode" "receipt_mode" DEFAULT 'NEFT' NOT NULL,
	"reference_no" text,
	"notes" text,
	CONSTRAINT "receipt_amount_positive" CHECK ("receipt"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"receipt_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "receipt_allocation_amount_positive" CHECK ("receipt_allocation"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage" ADD CONSTRAINT "stage_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage" ADD CONSTRAINT "stage_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_enquiry_id_enquiry_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design" ADD CONSTRAINT "design_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design" ADD CONSTRAINT "design_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design" ADD CONSTRAINT "design_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design" ADD CONSTRAINT "design_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_process" ADD CONSTRAINT "design_process_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_process" ADD CONSTRAINT "design_process_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_process" ADD CONSTRAINT "design_process_design_id_design_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."design"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_process" ADD CONSTRAINT "design_process_stage_code_stage_code_fk" FOREIGN KEY ("stage_code") REFERENCES "public"."stage"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_item" ADD CONSTRAINT "po_item_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_item" ADD CONSTRAINT "po_item_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_item" ADD CONSTRAINT "po_item_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_item" ADD CONSTRAINT "po_item_design_id_design_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."design"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_enquiry_id_enquiry_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_po_item_id_po_item_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."po_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_event" ADD CONSTRAINT "stage_event_po_item_id_po_item_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."po_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_event" ADD CONSTRAINT "stage_event_job_card_id_job_card_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_event" ADD CONSTRAINT "stage_event_stage_code_stage_code_fk" FOREIGN KEY ("stage_code") REFERENCES "public"."stage"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_event" ADD CONSTRAINT "stage_event_entered_by_app_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_line" ADD CONSTRAINT "dispatch_line_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_line" ADD CONSTRAINT "dispatch_line_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_line" ADD CONSTRAINT "dispatch_line_dispatch_id_dispatch_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_line" ADD CONSTRAINT "dispatch_line_po_item_id_po_item_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."po_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_dispatch_line_id_dispatch_line_id_fk" FOREIGN KEY ("dispatch_line_id") REFERENCES "public"."dispatch_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_receipt_id_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_changed_by_app_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user" USING btree ("username") WHERE "app_user"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "client_code_key" ON "client" USING btree ("code") WHERE "client"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "client_name_idx" ON "client" USING btree ("name");--> statement-breakpoint
CREATE INDEX "stage_sequence_idx" ON "stage" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiry_no_key" ON "enquiry" USING btree ("enquiry_no") WHERE "enquiry"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "enquiry_client_idx" ON "enquiry" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "enquiry_status_idx" ON "enquiry" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_no_key" ON "quotation" USING btree ("quote_no") WHERE "quotation"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "quotation_enquiry_idx" ON "quotation" USING btree ("enquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_code_key" ON "design" USING btree ("design_code") WHERE "design"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "design_client_idx" ON "design" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "design_job_name_idx" ON "design" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "design_process_stage_idx" ON "design_process" USING btree ("stage_code");--> statement-breakpoint
CREATE UNIQUE INDEX "po_item_code_key" ON "po_item" USING btree ("item_code") WHERE "po_item"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "po_item_purchase_order_idx" ON "po_item" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "po_item_design_idx" ON "po_item" USING btree ("design_id");--> statement-breakpoint
CREATE INDEX "po_item_committed_date_idx" ON "po_item" USING btree ("committed_date");--> statement-breakpoint
CREATE INDEX "po_item_status_idx" ON "po_item" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_internal_no_key" ON "purchase_order" USING btree ("internal_no") WHERE "purchase_order"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "purchase_order_client_idx" ON "purchase_order" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "purchase_order_status_idx" ON "purchase_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchase_order_date_idx" ON "purchase_order" USING btree ("po_date");--> statement-breakpoint
CREATE UNIQUE INDEX "job_card_no_key" ON "job_card" USING btree ("jc_no") WHERE "job_card"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "job_card_po_item_idx" ON "job_card" USING btree ("po_item_id");--> statement-breakpoint
CREATE INDEX "job_card_planned_date_idx" ON "job_card" USING btree ("planned_date");--> statement-breakpoint
CREATE INDEX "job_card_status_idx" ON "job_card" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stage_event_po_item_event_at_idx" ON "stage_event" USING btree ("po_item_id","event_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stage_event_stage_code_idx" ON "stage_event" USING btree ("stage_code");--> statement-breakpoint
CREATE INDEX "stage_event_job_card_idx" ON "stage_event" USING btree ("job_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_challan_no_key" ON "dispatch" USING btree ("challan_no") WHERE "dispatch"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "dispatch_client_idx" ON "dispatch" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "dispatch_date_idx" ON "dispatch" USING btree ("dispatch_date");--> statement-breakpoint
CREATE INDEX "dispatch_status_idx" ON "dispatch" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dispatch_line_dispatch_idx" ON "dispatch_line" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "dispatch_line_po_item_idx" ON "dispatch_line" USING btree ("po_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_no_key" ON "invoice" USING btree ("invoice_no") WHERE "invoice"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "invoice_client_idx" ON "invoice" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoice_date_idx" ON "invoice" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "invoice_due_date_idx" ON "invoice" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "invoice_status_idx" ON "invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_dispatch_line_key" ON "invoice_line" USING btree ("dispatch_line_id") WHERE "invoice_line"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_no_key" ON "receipt" USING btree ("receipt_no") WHERE "receipt"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "receipt_client_idx" ON "receipt" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "receipt_date_idx" ON "receipt" USING btree ("receipt_date");--> statement-breakpoint
CREATE INDEX "receipt_allocation_receipt_idx" ON "receipt_allocation" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_allocation_invoice_idx" ON "receipt_allocation" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "audit_log_record_idx" ON "audit_log" USING btree ("table_name","record_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_changed_at_idx" ON "audit_log" USING btree ("changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_changed_by_idx" ON "audit_log" USING btree ("changed_by");
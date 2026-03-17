<div align="center">

# 🌿 Kaitet Taskwork

**A full-cycle task workforce management system built on Frappe / ERPNext**
*Plan · Assign · Track · Pay — all in one place*

---

[![Frappe](https://img.shields.io/badge/Built%20on-Frappe%20v15-0089FF?style=for-the-badge&logo=frappe&logoColor=white)](https://frappeframework.com)
[![ERPNext](https://img.shields.io/badge/Integrates%20with-ERPNext-0C4B33?style=for-the-badge)](https://erpnext.com)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Publisher](https://img.shields.io/badge/Publisher-Upande%20Ltd-FF6B35?style=for-the-badge)](https://upande.com)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture & Data Flow](#-architecture--data-flow)
- [Doctypes Reference](#-doctypes-reference)
  - [Task Worker](#1-task-worker)
  - [Work Location](#2-work-location)
  - [Task Work Request](#3-task-work-request)
  - [Task Work Plan](#4-task-work-plan)
  - [Task Work Assignment](#5-task-work-assignment)
  - [TW Weekly Disbursement](#6-tw-weekly-disbursement)
  - [Employee Weekly Off Plan](#7-employee-weekly-off-plan)
  - [Bulk Overtime Requisition](#8-bulk-overtime-requisition)
  - [TW Employee Change Request](#9-tw-employee-change-request)
- [Workflow Diagrams](#-workflow-diagrams)
- [Roles & Permissions](#-roles--permissions)
- [Scheduled Automations](#-scheduled-automations)
- [Installation](#-installation)
- [Configuration](#-configuration)

---

## 🌍 Overview

**Kaitet Taskwork** is a specialized Frappe application designed for agricultural farm operations — managing contracted task workers from initial work requests all the way through to payroll disbursement. It fills the gap between standard ERPNext HR (which manages salaried employees) and the reality of daily-rate farm labor.

> **What problem does it solve?**
> Large farms employ hundreds of task workers — casual laborers paid daily or piece-rate — whose schedules, assignments, and payments are typically managed on paper. Kaitet Taskwork brings this entire process into a structured, auditable digital workflow.

### The Complete Journey

```
Farm Manager raises request  →  GM & HR approve  →  Plan is created
      ↓
Workers assigned to tasks  →  Work is tracked  →  Payments calculated
      ↓
Weekly disbursement aggregates actual pay  →  Journal Entry posted  →  Workers paid
```

---

## ✨ Key Features

### 🧑‍🌾 Worker Registry
- Dedicated **Task Worker** master (separate from Employee) for contracted workers
- Auto-generated **5-digit payroll numbers** with uniqueness enforcement across both Task Workers and Employees
- Supports **Bank Transfer** and **M-Pesa** payment methods with conditional field validation
- Worker availability tracking — know instantly who is free vs. currently assigned

### 📋 Request → Plan → Assign Pipeline
- Structured **multi-level approval** workflow: Farm Manager → General Manager → HR
- **Task Work Plan** auto-detects understaffing and extends timelines intelligently
- **Task Work Assignment** tracks actual work done vs. planned, calculates achievement percentages
- Prevents over-allocation — total actual quantities can never exceed planned total work

### 💰 Weekly Disbursement & Payroll
- **ISO week-based** disbursement that spans multiple assignments automatically
- One-click **"Load Worker Payments"** aggregates actual work costs from all overlapping assignments
- Manual deductions support (advances, loans, tax adjustments)
- Automated **Journal Entry creation** on "Mark as Paid" (debit wages account, credit payment account)
- Separate **Bank** and **M-Pesa** print formats for payment processing

### ⏰ Overtime Management
- **Bulk Overtime Requisition** for requesting overtime for groups of employees at once
- Supports Normal, Holiday, and Weekend overtime types
- Lunch and After-Hours overtime periods
- Full approval workflow with cost estimation

### 📅 HR Scheduling Utilities
- **Employee Weekly Off Plan** — assign holiday lists to employees for a period, auto-revert on expiry
- **Holiday List rollover** — automatically creates next year's lists in November
- **Security guard attendance automation** — marks guards on leave after 60+ hours in a week

### 🔄 Worker Reassignment
- **TW Employee Change Request** — safely swap or add workers on live assignments
- Replace only removes rows where no actual work has been recorded
- HR approval before any changes are applied

---

## 🏗️ Architecture & Data Flow

### Document Hierarchy

```
Work Location (config)          Task Worker (master)
        │                               │
        └──────────────┬────────────────┘
                       │
              Task Work Request  ◄─── Farm Manager raises request
                       │ (approved by GM + HR)
                       │
              Task Work Plan  ◄─── Farm Manager creates plan
                       │ (detect understaffing, adjust timelines)
                       │
              Task Work Assignment  ◄─── Assign workers to tasks
                       │ (track actual work done)
                       │
              TW Weekly Disbursement  ◄─── Aggregate weekly payments
                       │ (Approve → Mark as Paid)
                       │
              Journal Entry (ERPNext)  ◄─── Wages posted to accounts
```

### Stage Progression

| Document | Stages |
|---|---|
| Task Work Request | `Requested` → `Planned` → `Assigned` |
| Task Work Plan | `Planned` → `Assigned` → `In Progress` → `Completed` |
| Task Work Assignment | `Pending` → `In Progress` → `Completed` |
| TW Weekly Disbursement | `Draft` → `Pending` → `Approved` → `Paid` |

---

## 📂 Doctypes Reference

### 1. Task Worker

> **The master record for contracted task workers** — the equivalent of an Employee card but for daily-rate labor.

**Path:** `app/task-worker`

#### Fields

| Field | Type | Description |
|---|---|---|
| `payroll_number` | Data | Auto-generated 5-digit unique ID. Read-only after creation |
| `current_assignment` | Link → Task Work Assignment | Populated automatically when assigned; cleared on completion |
| `first_name` / `last_name` | Data | Required. `full_name` is auto-calculated |
| `id_number` | Data | **Mandatory.** National ID or passport number |
| `phone` | Phone (Kenya +254) | Optional. Prefixed with Kenya country code |
| `gender` | Select | Male / Female / Other |
| `date_of_birth` | Date | |
| `photo` | Attach Image | |
| `status` | Select | `Active` / `Inactive` / `Suspended`. Default: Active |
| `payment_method` | Select | `Bank Transfer` / `M-Pesa`. Default: Bank Transfer |
| **— Bank Details** | | Shown when payment_method = Bank Transfer |
| `bank_name` | Link → Bank | Required if Bank Transfer |
| `account_number` | Data | Required if Bank Transfer |
| `account_name` | Data | |
| `branch_name` | Data | |
| **— M-Pesa Details** | | Shown when payment_method = M-Pesa |
| `mpesa_phone` | Phone (Kenya +254) | Required if M-Pesa |
| `mpesa_name` | Data | M-Pesa registered name |

#### Buttons & Actions

| Button | Condition | Action |
|---|---|---|
| **Save** | Always | Validates payment details; auto-generates `full_name` and `payroll_number` |

#### Business Logic

- **`autoname()`** — generates a unique 5-digit payroll number, checking both Task Workers and Employees to prevent collisions
- **`validate()`** — enforces payment method completeness (bank details or M-Pesa details based on method chosen)
- **`get_available_task_workers()`** — whitelisted API returning `Active` workers with no `current_assignment`, used to populate assignment grids

---

### 2. Work Location

> **Configuration master** for physical locations where tasks are performed.

#### Fields

| Field | Type | Description |
|---|---|---|
| `location_name` | Data | Unique name (used as document name) |
| `location_type` | Select | Greenhouse / Bed / Dairy / Other In-Farm Duty |
| `farm` | Data | Farm or unit division name |
| `cost_centre` | Link → Cost Center | **Required.** Maps location to accounting cost centre |
| `status` | Select | Active / Inactive. Default: Active |
| `description` | Small Text | Optional notes |

---

### 3. Task Work Request

> **The starting point of every task work cycle.** A Farm Manager raises a request describing what work is needed, how many workers, and at what rate.

**Naming:** `title` (unique, set by user)

#### Fields

| Field | Type | Description |
|---|---|---|
| `farm_managers_name` | Link → Employee | **Required.** The requesting manager |
| `unitdivision` | Data | Auto-fetched from manager's farm assignment |
| `company` | Link → Company | Auto-fetched from manager |
| `business_unit` | Data | Auto-fetched from manager |
| `posting_date` | Datetime | **Required** |
| `stage` | Select | `Requested` / `Planned` / `Assigned` — system-managed, read-only |
| `task_request_details` | Table | Child rows — one per task type |
| `total_workers` | Int | Auto-summed from child rows. Read-only |
| `estimated_cost` | Currency | Auto-summed from child rows. Read-only |

#### Child Table: Task Request Details

| Field | Description |
|---|---|
| `task_name` | Name/description of the task |
| `task` | Link to ERPNext Task doctype |
| `total_work` | Total quantity of work (e.g. total stems to harvest) |
| `daily_target` | Expected output per worker per day |
| `workers` | Number of workers required |
| `payment_type` | How workers are paid for this task |
| `rate` | Pay rate |
| `uom` | Unit of measurement |
| `estimated_cost` | Auto-calculated: total_work × rate |
| `start_date` / `end_date` | Optional schedule dates |

#### Workflow & Buttons

```
[Submit]
    │
    ▼  Stage: "Requested"
    │   └── Notifies General Manager
    │
[GM Approves via Workflow]
    │   └── Notifies Owner + HR Manager
    │
[HR Approves via Workflow]
    │   └── Stage: Fully Approved; notifies Farm Manager
    │
[Create Plan from Request]  ←── Visible once fully approved
    └── Creates a Task Work Plan linked to this Request
```

| Button | Condition | Action |
|---|---|---|
| **Submit** | Draft | Submits the request; sets stage = `Requested`; notifies GM |
| **Create Plan** | Workflow state: Approved by HR | Calls `create_plan_from_request()` → opens new Task Work Plan |
| **Amend** | Submitted / Cancelled | Creates amendment copy |

---

### 4. Task Work Plan

> **The planning layer.** A Farm Manager takes an approved request and plans which workers will do what, automatically handling cases where fewer workers are available than required.

**Naming:** `TWP-.YYYY.-` (auto series)

#### Fields

| Field | Type | Description |
|---|---|---|
| `managers_name` | Link → Employee | **Required** |
| `unitdivision` / `business_unit` / `company` | Data / Link | Auto-fetched from manager |
| `cost_centre` | Link → Cost Center | Auto-determined from manager's business unit |
| `task_work_request_ref` | Link → Task Work Request | The approved request this plan fulfils |
| `no_of_approved_workers` | Int | Fetched from Request. Read-only |
| `approved_estimated_cost` | Currency | Fetched from Request. Read-only |
| `posting_date` | Datetime | **Required** |
| `custom_expected_start_date` / `custom_expected_end_date` | Date | |
| `custom_location` | Link → Work Location | |
| `stage` | Select | `Planned` → `Assigned` → `In Progress` → `Completed` |
| `entries` | Table | Task plan rows (task + worker allocation) |
| `total_workers_planned` | Int | Auto-summed. Read-only |
| `understaffed_tasks` | Int | Count of rows where available < required. Read-only |

#### Child Table: Entries (Task Plan)

| Field | Description |
|---|---|
| `task_name` / `task` | Task being planned |
| `workers_required` | How many workers the request called for |
| `workers_available` | How many are actually available right now |
| `workers_assigned` | Adjusted count (may be less if understaffed) |
| `understaffed` | Checkbox — set automatically if available < required |
| `daily_target` / `adjusted_daily_target` | Original vs. recalculated daily target for understaffing |
| `total_work` / `rate` / `uom` | Task specs |
| `estimated_cost` | Auto-calculated |
| `start_date` / `end_date` | May be extended if understaffed |

#### Understaffing Auto-Adjustment

When `workers_available < workers_required`, the app automatically:

1. Sets `understaffed = 1` on the row
2. Calculates efficiency ratio: `available ÷ required`
3. Extends `end_date` proportionally (takes longer with fewer workers)
4. Recalculates `adjusted_daily_target` to complete `total_work` in the extended timeline

> **Example:** Task requires 10 workers, only 6 available. Efficiency = 60%.
> Original: 5 days. Adjusted: ~8 days. Daily target recalculated accordingly.

#### Buttons & Actions

| Button | Condition | Action |
|---|---|---|
| **Submit** | Draft | Sets stage = `Planned`; updates Request stage; notifies Farm Manager |
| **Create Assignment** | Submitted | Calls `create_assignment_from_plan()` → opens new Task Work Assignment |
| **Understaffing Summary** | Has understaffed tasks | Dialog showing per-task worker shortage details |
| **Check Worker Availability** | Any | API call showing available/busy workers per task |
| **Optimize Task Sequence** | Any | Sorts tasks by priority; adjusts dates to avoid overlaps |
| **Get Worker Workload** | Any | Per-worker task distribution breakdown |
| **Calculate Task Duration** | Any | Recalculates days needed = total_work ÷ (daily_target × workers) |
| **Amend** | Submitted | Creates amendment copy |

---

### 5. Task Work Assignment

> **The execution document.** Records exactly who does what, tracks actual completion, and feeds into payment calculations.

**Naming:** `TWO.-` (auto series)

#### Fields

| Field | Type | Description |
|---|---|---|
| `farm_manager` | Link → Employee | Fetched from Request |
| `task_work_request` | Link → Task Work Request | |
| `task_work_plan` | Link → Task Work Plan | |
| `unitdivision` / `business_unit` / `company` / `cost_centre` | | Inherited from Plan |
| `expected_start_date` / `expected_end_date` | Date | Fetched from Plan |
| `start_date` / `completion_date` | Date | Actual dates (editable) |
| `stage` | Select | `Pending` → `In Progress` → `Completed` — auto-updated |
| `task_details` | Table | What work is to be done (task-level breakdown) |
| `worker_assignments` | Table | Who does what (per-worker allocation) |
| `total_estimated_cost` | Currency | Sum of all worker assignment costs. Read-only |

#### Child Table: Task Details

| Field | Description |
|---|---|
| `task` / `task_name` | The task |
| `uom` | Unit of measurement |
| `daily_target` / `total_work` / `rate` | Task specs from Plan |
| `workers` / `days` | Planned staffing |
| `estimated_cost` | Auto-calculated |
| `actual_start_date` / `actual_completion_date` | Filled as work progresses |
| `status` | Pending / In Progress / Completed |

#### Child Table: Worker Assignments

| Field | Description |
|---|---|
| `employee_name` | Link to Task Worker |
| `worker_full_name` | Auto-fetched. Read-only |
| `task` | Which task this worker is assigned to |
| `assignment_date` | Date of this work |
| `uom` / `daily_target` / `quantity_assigned` / `days` | What this worker should do |
| `rate` | Pay rate |
| `total_assigned_cost` | Read-only: quantity_assigned × rate |
| `actual_quantity` | **Editable.** What the worker actually completed |
| `actual_cost` | Read-only: actual_quantity × rate |
| `achievement` | Read-only: (actual_quantity ÷ quantity_assigned) × 100% |
| `location` | Work location for this row |

#### Key Constraint

> ⚠️ **Over-allocation prevention:** The sum of `actual_quantity` across all worker rows for a given task cannot exceed that task's `total_work`. The system raises a validation error if this limit is breached.

#### Stage Auto-Update Logic

| Event | Stage Change | Side Effect |
|---|---|---|
| Submit | → `Pending` | Workers marked busy (`current_assignment` set); Request & Plan stage → `Assigned` |
| start_date set + actual work recorded | → `In Progress` | — |
| All tasks `Completed` | → `Completed` | Workers freed (`current_assignment` cleared) |
| Cancel | → Cancelled | Workers freed immediately |

#### Buttons & Actions

| Button | Condition | Action |
|---|---|---|
| **Submit** | Draft | Locks assignment; marks workers busy; updates upstream stages |
| **Auto-Assign Workers** | Submitted | `auto_assign_workers()` — fills `worker_assignments` grid from task specs and availability |
| **Get Workers for Task** | Submitted | `get_workers_for_task()` — shows available workers with current workload counts |
| **Task Progress** | Submitted | `get_task_progress()` — per-task % complete, remaining work, status |
| **Completion Summary** | Submitted | `get_completion_summary()` — overall % done, actual cost vs. estimate |
| **Reassign Worker** | Submitted | `reassign_worker()` — moves work from one worker to another |
| **Request Worker Change** | Submitted | Opens TW Employee Change Request linked to this assignment |
| **Amend** | Cancelled | Creates amendment copy |

---

### 6. TW Weekly Disbursement

> **The payment aggregation document.** At the end of each week, a single disbursement document pulls actual costs from all overlapping assignments, calculates net pay per worker, and generates the accounting Journal Entry.

**Naming:** `TWD-.YYYY.-` (auto series)

#### Fields

| Field | Type | Description |
|---|---|---|
| `year` | Int | The year. Default: current year |
| `week_number` | Int | ISO week number. Drives `week_start_date` / `week_end_date` |
| `week_start_date` | Date | Auto-calculated (Monday of the week). Read-only |
| `week_end_date` | Date | Auto-calculated (Sunday of the week). Read-only |
| `company` | Link → Company | **Required** |
| `posting_date` | Date | **Required.** Default: today |
| `wages_account` | Link → Account | **Required.** Expense account for wages (e.g. Daily Rate Wages) |
| `payment_account` | Link → Account | **Required.** Bank/cash account wages are paid from |
| `status` | Select | `Draft` → `Pending` → `Approved` → `Paid` — system-managed |
| `disbursement_entries` | Table | Per-worker: gross, deductions, net pay |
| `task_breakdown` | Table | Per-assignment cost summary |
| `total_workers` | Int | Count. Read-only |
| `total_gross` | Currency | Sum. Read-only |
| `total_deductions` | Currency | Sum. Read-only |
| `total_net` | Currency | Sum. Read-only |
| `journal_entry` | Link → Journal Entry | Created on Mark as Paid |
| `payment_reference` | Data | Bank ref or M-Pesa transaction ID |
| `payment_date` | Date | When payment was made |
| `paid_on` | Datetime | System timestamp when marked as paid |
| `paid_by` | Link → User | Who clicked Mark as Paid |

#### Child Table: Disbursement Entries

| Field | Description |
|---|---|
| `task_worker` | Link to Task Worker |
| `worker_name` | Auto-fetched. Read-only |
| `payment_method` | Auto-fetched (Bank / M-Pesa). Read-only |
| `bank_or_mpesa` | Account number or M-Pesa number. Read-only |
| `gross_amount` | Aggregated actual_cost from all assignments. Read-only |
| `deductions` | **Editable.** Manual deductions (loans, advances, etc.) |
| `net_amount` | Read-only: gross − deductions. Auto-recalculates on change |
| `paid` | Checkbox — system sets to 1 when JE is posted |
| `payment_reference` | Reference for this specific worker's payment |

#### Child Table: Task Breakdown

| Field | Description |
|---|---|
| `daily_form_ref` | Link to Task Work Assignment |
| `task_name` | Task name |
| `work_date` | Start of week |
| `work_location` | Unit/division |
| `cost_centre` | Cost centre for journal entry split |
| `amount` | Total wages from this assignment for the week |

#### Buttons & Actions

| Button | Status | Action |
|---|---|---|
| **Load Worker Payments for Week** | `Draft` | Calls `get_worker_payments()` — scans all Task Work Assignments overlapping the selected ISO week; populates `disbursement_entries` (per worker totals) and `task_breakdown` (per assignment summary) |
| **Submit** | Draft, after loading | Sets status → `Pending` |
| **Approve** | `Pending` | HR/Finance approval; sets status → `Approved` |
| **Mark as Paid** | `Approved` | Creates Journal Entry; sets status → `Paid`; records paid_on / paid_by |

#### Journal Entry Structure (created on Mark as Paid)

```
Journal Entry (Auto-created)
├── Debit:  wages_account   (split per cost_centre if available)  ← wages expense
└── Credit: payment_account                                        ← cash/bank outflow
```

#### Week Date Calculation

When `year` or `week_number` is changed:
- `week_start_date` = Monday of that ISO week (e.g. Week 12, 2026 = 2026-03-16)
- `week_end_date` = `week_start_date + 6 days` (Sunday)

> ⚠️ **Duplicate protection:** If a `Paid` disbursement already exists for the same company and week, saving a new one raises a validation error.

#### Print Formats
- **Bank Transfer Print Format** — lists worker names, account numbers, net amounts
- **M-Pesa Print Format** — lists worker names, M-Pesa numbers, net amounts

---

### 7. Employee Weekly Off Plan

> **Manages rotating weekly off schedules for employees** — assigns Holiday Lists to employees for a defined period and automatically reverts them when the period expires.

**Naming:** `title` (unique)

#### Fields

| Field | Type | Description |
|---|---|---|
| `manager` | Link → Employee | **Required.** The manager creating this plan |
| `manager_name` | Data | Auto-fetched |
| `company` / `business_unit` | | Auto-fetched from manager |
| `start_date` | Date | **Required.** When this schedule begins |
| `end_date` | Date | When this schedule expires |
| `weekly_offs` | Table | Per-employee off day assignments |
| `reverted` | Check | Set to 1 automatically when expired and reverted by scheduler |

#### Child Table: Weekly Offs

| Field | Description |
|---|---|
| `employee_name` | Link to Employee |
| `employee` | Payroll/employee number. Auto-fetched |
| `category` | Employee category. Auto-fetched |
| `unitdivision` | Employee's farm. Auto-fetched |
| `week_day` | Sunday / Monday / … / Saturday |
| `holiday_list` | The Holiday List to assign. Set on submit |
| `previous_holiday_list` | Hidden. Saves original Holiday List for safe revert |

#### Buttons & Actions

| Button | Condition | Action |
|---|---|---|
| **Submit** | Draft | For each row: saves `previous_holiday_list` → assigns new Holiday List to Employee |
| **Cancel** | Submitted | Reverts all employees back to their `previous_holiday_list` |

> **Automatic revert:** A daily scheduled job `revert_expired_weekly_off_plans()` checks all submitted plans where `end_date < today`. It reverts each employee's Holiday List and marks `reverted = 1` on the plan.

---

### 8. Bulk Overtime Requisition

> **Request overtime for entire teams at once.** Instead of creating individual overtime claims, a manager can request overtime for a whole group in a single document with cost estimation.

**Naming:** `title` (unique)

#### Fields

| Field | Type | Description |
|---|---|---|
| `managersupervisor_name` | Link → Employee | **Required** |
| `payroll_no` | Data | Auto-fetched from manager |
| `unitdivision` / `business_unit` / `custom_company` | | Auto-fetched from manager |
| `posting_date` | Datetime | **Required** |
| `overtime_type` | Select | Normal / Holiday / Weekend |
| `overtime_period` | Select | Lunch Overtime / After-Hours Overtime |
| `from_date` / `end_date` | Date | Overtime period |
| `from_time` / `to_time` | Time | Start and end times |
| `hours` | Duration | |
| `reason` | Small Text | **Required** |
| `hourly_rate` | Currency | **Required.** Rate per employee per hour |
| `total_employees` | Int | Auto-counted from `entries`. Read-only |
| `estimated_cost` | Currency | `total_employees × hours × hourly_rate`. Read-only |
| `entries` | Table | List of employees in this overtime |

#### Child Table: Overtime Entry

| Field | Description |
|---|---|
| `employee_name` | Link to Employee |
| `payroll_no` | Auto-fetched |
| `department` | Auto-fetched |
| `greenhouse` | Auto-fetched |

#### Workflow & Buttons

```
[Submit]
    │
    ▼  Awaiting GM Approval → notifies General Manager
[GM Approves]
    │
    ▼  Approved by GM → notifies HR Manager
[HR Approves]
    │
    ▼  Fully Approved → notifies requester
    │
[Create Overtime Claim]  ←── Visible after full approval
    └── create_overtime_claim_from_bulk() → one OT Claim per employee
```

| Button | Condition | Action |
|---|---|---|
| **Submit** | Draft | Starts approval workflow; notifies GM |
| **Create Overtime Claim** | Fully Approved | `create_overtime_claim_from_bulk()` — creates an Overtime Claim for each employee in `entries` |
| **Amend** | Cancelled | Creates amendment copy |

---

### 9. TW Employee Change Request

> **Manages worker changes on live assignments.** If a worker becomes unavailable mid-task, or extra workers are needed, this document allows safe reassignment with HR oversight before any changes take effect.

#### Fields

| Field | Type | Description |
|---|---|---|
| `title` | Data | Auto-generated: `"{change_type} – {new_emp_name} on {assignment}"` |
| `task_work_assignment` | Link → Task Work Assignment | **Required** |
| `change_type` | Select | `Add Employee` / `Replace Employee` |
| `status` | Select | `Draft` → `Pending HR Approval` → `Approved` / `Rejected` |
| `new_employee` | Link → Task Worker | **Required.** The worker to add or the replacement |
| `old_employee` | Link → Task Worker | Required if `change_type = Replace Employee` |
| `task` | Link → Task | Optional — limit the change to a specific task |
| `reason` | Small Text | **Required** |
| `selected_rows` | JSON | Hidden — stores specific assignment row names when replacing |
| `requested_by` | Link → User | Auto-set on insert |
| `approved_by` | Link → User | Set on approval |
| `approval_date` | Date | Set on approval |
| `approval_notes` | Small Text | Optional notes from approver |

#### Add vs Replace Logic

**Add Employee** (`_smart_assign_remaining()`):
1. Calculates work already assigned across all existing workers per task
2. Identifies remaining work: `total_work − already_assigned`
3. Creates new `worker_assignments` rows distributing remaining work across days

**Replace Employee** (`_replace_worker()`):
1. Finds rows for `old_employee` where `actual_quantity = 0` (no work yet recorded)
2. Creates identical rows for `new_employee`
3. Removes the old unworked rows

> ⚠️ **Safety rule:** Rows where `actual_quantity > 0` are never touched — work already done cannot be retroactively reassigned.

#### Buttons & Actions

| Button | Condition | Action |
|---|---|---|
| **Submit for Approval** | Draft | Sets status = `Pending HR Approval`; notifies HR Manager |
| **Approve** | Pending HR Approval (HR role) | Sets `approved_by` + `approval_date`; immediately applies the worker change |
| **Reject** | Pending HR Approval (HR role) | Sets status = `Rejected`; notifies requester |

---

## 🔄 Workflow Diagrams

### Main Task Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     TASK WORK REQUEST                           │
│  Farm Manager fills task details + worker counts + rates       │
│  ↓ Submit                                                       │
│  Stage: Requested  →  Notifies General Manager                 │
└────────────────────────────┬────────────────────────────────────┘
                             │  GM approves via workflow
┌────────────────────────────▼────────────────────────────────────┐
│  GM Approval  →  Notifies HR Manager + Owner                   │
│  HR Approval  →  Notifies Farm Manager (Fully Approved)        │
└────────────────────────────┬────────────────────────────────────┘
                             │  Farm Manager clicks [Create Plan]
┌────────────────────────────▼────────────────────────────────────┐
│                      TASK WORK PLAN                             │
│  ↓ App checks worker availability per task                     │
│  ↓ Understaffed tasks? → extend timeline + adjust targets      │
│  ↓ Submit  →  Stage: Planned  →  Notifies Farm Manager         │
└────────────────────────────┬────────────────────────────────────┘
                             │  Farm Manager clicks [Create Assignment]
┌────────────────────────────▼────────────────────────────────────┐
│                   TASK WORK ASSIGNMENT                          │
│  ↓ Add task_details (what work) + worker_assignments (who)     │
│  ↓ Submit  →  Stage: Pending                                   │
│           →  Workers marked busy (current_assignment set)      │
│           →  Request + Plan stage updated → Assigned           │
└────────────────────────────┬────────────────────────────────────┘
                             │  Work proceeds; manager fills actual_quantity
┌────────────────────────────▼────────────────────────────────────┐
│                  TW WEEKLY DISBURSEMENT                         │
│  ↓ [Load Worker Payments]  →  scans overlapping assignments    │
│    →  populates entries per worker + task breakdown            │
│  ↓ Adjust deductions per worker (loans, advances, etc.)        │
│  ↓ Submit  →  Status: Pending                                  │
│  ↓ HR clicks [Approve]  →  Status: Approved                    │
│  ↓ Finance clicks [Mark as Paid]                               │
│    →  Journal Entry posted (DR wages / CR bank)                │
│    →  Status: Paid                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Understaffing Auto-Resolution

```
workers_required  = 10
workers_available =  6

efficiency_ratio  =  6 ÷ 10  =  0.60  (60%)

Original plan:   5 days,  daily_target = 20 units/day,  total = 100 units
                 ↓
Adjusted plan:   days  = 5 ÷ 0.60  =  ~8 days    (extended)
                 adj_daily_target  = 100 ÷ (8 × 6) = ~2.1 units/worker/day
                 end_date pushed out by 3 days
```

### Worker Reassignment Flow

```
Manager identifies need for worker change
    │
    ▼
[Create TW Employee Change Request]
    │
    ├── change_type = "Add Employee"
    │       ↓
    │   Smart-allocates remaining unassigned work to new worker
    │
    └── change_type = "Replace Employee"
            ↓
        Swaps old → new only on rows with actual_quantity = 0
        (rows with recorded work are never touched)
    │
    ▼
[Submit for Approval]  →  Notifies HR Manager
    │
[HR Approves]  →  Change applied immediately to Assignment
```

---

## 👥 Roles & Permissions

| Role | Task Worker | Work Location | TW Request | TW Plan | TW Assignment | TW Disbursement | OT Requisition |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **System Manager** | Full | Full | Full | Full | Full | Full | Full |
| **Farm Manager** | Full | Read | Full | Full | Full | Read | — |
| **General Manager** | Read | Full | Full | Read | Read | Read | Read |
| **HR Manager** | Full | Read | Read | Read | Read | Full | Full |

> **Full** = Create, Read, Write, Delete, Submit, Cancel, Amend
> **Read** = Read-only access

---

## ⏱️ Scheduled Automations

Three jobs run automatically every day:

### 1. Revert Expired Weekly Off Plans
```
Trigger: Daily
Function: kaitet_taskwork.kaitet_taskwork.doctype.employee_weekly_off_plan
                .employee_weekly_off_plan.revert_expired_weekly_off_plans
```
Finds all submitted `Employee Weekly Off Plan` records where `end_date < today` and `reverted = 0`. Restores each employee's original Holiday List and marks the plan `reverted = 1`.

### 2. Holiday List Rollover
```
Trigger: Daily (acts in November)
Function: kaitet_taskwork.kaitet_taskwork.utils.rollover_holiday_lists
```
Activates each November. Copies all holidays from the current year to next year (adjusting dates, handling Feb 29 leap year edge case). Reassigns all Employee and Weekly Off records pointing to old-year Holiday Lists to the new-year equivalents.

### 3. Security Guard Attendance
```
Trigger: Daily
Function: kaitet_taskwork.kaitet_taskwork.utils.process_security_guard_attendance
```
Sums submitted Attendance records for security guards in the current Mon–Sun week. If a guard has **60+ hours worked**, creates draft `On Leave` Attendance records for remaining weekdays so payroll is correct. Records are saved as **draft** so supervisors can override if needed.

---

## 🚀 Installation

### Prerequisites

- Frappe Bench v15+
- ERPNext v15+
- Python 3.11+

### Steps

```bash
# 1. Navigate to your bench directory
cd /path/to/your-bench

# 2. Get the app
bench get-app kaitet_taskwork https://github.com/teddy5456/Upande_HR.git

# 3. Install on your site
bench --site your-site.local install-app kaitet_taskwork

# 4. Run migrations
bench --site your-site.local migrate

# 5. Build assets
bench build --app kaitet_taskwork

# 6. Restart
bench restart
```

### Development Install (editable mode)

```bash
# Install in editable mode
./env/bin/pip install -e apps/kaitet_taskwork

# Add to site apps
echo "" >> sites/apps.txt && echo "kaitet_taskwork" >> sites/apps.txt

# Install and migrate
bench --site your-site.local install-app kaitet_taskwork
bench --site your-site.local migrate
bench build --app kaitet_taskwork
```

---

## ⚙️ Configuration

After installation, complete these setup steps before use:

**1. Create Work Locations**
Go to `Work Location` and define your farm's zones (greenhouses, dairy, fields, etc.) with their respective cost centres.

**2. Register Task Workers**
Create a `Task Worker` record for each contracted worker. Set their payment method (Bank Transfer or M-Pesa) and fill in the required details.

**3. Configure Payroll Accounts**
Ensure ERPNext has:
- A **wages expense account** (e.g. `Daily Rate Wages - KL`) for disbursement debits
- A **bank or cash account** to credit on payment

**4. Assign Roles**
- Farm Managers → `Farm Manager` role
- HR staff → `HR Manager` role
- Senior management → `General Manager` role

**5. Verify Workflows**
The `Task Work Request` and `Bulk Overtime Requisition` both rely on Frappe's workflow engine. Ensure the approval workflows are assigned to the correct roles in `Workflow` settings.

**6. Confirm App Entry Point**
The app appears in the Frappe desk as **"Upande HR"** — navigates to `/app/task-worker` by default.

---

<div align="center">

---

Built with ❤️ by **[Upande Ltd](https://upande.com)**

*Empowering Kenyan agriculture with open-source ERP*

[![Frappe](https://img.shields.io/badge/Frappe-Framework-0089FF?style=flat-square)](https://frappeframework.com)
[![ERPNext](https://img.shields.io/badge/ERPNext-v15-0C4B33?style=flat-square)](https://erpnext.com)

</div>

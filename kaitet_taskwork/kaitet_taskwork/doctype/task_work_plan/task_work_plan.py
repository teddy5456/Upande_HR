# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, today, getdate, add_days, date_diff, now_datetime
import json

from kaitet_taskwork.kaitet_taskwork.doctype.task_work_request.task_work_request import (
    _get_users_for_role_and_company,
    _send_to_user as _shared_send_to_user,
)

class TaskWorkPlan(Document):
    def validate(self):
        if self.task_work_request_ref:
            self.title = self.task_work_request_ref

        if self.managers_name:
            emp = frappe.db.get_value(
                "Employee", self.managers_name,
                ["custom_business_unit", "company", "custom_farm"],
                as_dict=True,
            )
            if emp:
                self.business_unit = emp.custom_business_unit or emp.company or self.business_unit
                if emp.custom_farm and not self.unitdivision:
                    self.unitdivision = emp.custom_farm

        if not self.cost_centre and self.managers_name:
            self.cost_centre = get_cost_centre_for_manager(self.managers_name)
            
        self.validate_dates()
        self.check_understaffing()
        self.calculate_totals()
        self.validate_worker_allocation()

    def on_submit(self):
        self.db_set("stage", "Planned")
        if self.task_work_request_ref:
            frappe.db.set_value(
                "Task Work Request", self.task_work_request_ref, "stage", "Planned"
            )
        self.create_notification("submitted")

    def on_cancel(self):
        self.db_set("stage", "Cancelled")
        
    def on_update(self):
        self._send_workflow_notification()
        
    def validate_dates(self):
        """Validate task dates"""
        if not self.custom_expected_start_date:
            frappe.throw(_("Expected Start Date is required"))
            
        for row in self.get("entries", []):
            if row.start_date and row.end_date:
                if getdate(row.end_date) < getdate(row.start_date):
                    frappe.throw(_("Row #{0}: End date cannot be before start date").format(row.idx))
    
    def check_understaffing(self):
        """Check for understaffed tasks and adjust"""
        understaffed_count = 0
        
        for row in self.get("entries", []):
            if row.workers_available and row.workers_required:
                if row.workers_available < row.workers_required:
                    row.understaffed = 1
                    row.workers_assigned = row.workers_available
                    understaffed_count += 1
                    
                    # Adjust timeline for understaffed task
                    self.adjust_timeline_for_understaffing(row)
                else:
                    row.understaffed = 0
                    row.workers_assigned = row.workers_required
        
        self.understaffed_tasks = understaffed_count
    
    def adjust_timeline_for_understaffing(self, row):
        """Adjust task timeline when understaffed"""
        if not row.start_date or not row.end_date or not row.total_work:
            return
            
        original_days = date_diff(row.end_date, row.start_date) + 1
        if original_days <= 0:
            return
            
        efficiency_ratio = row.workers_available / row.workers_required
        new_days_needed = frappe.utils.ceil(original_days / efficiency_ratio)
        
        if new_days_needed > original_days:
            new_end_date = add_days(row.start_date, new_days_needed - 1)
            row.end_date = new_end_date
            
            # Recalculate daily target
            if row.workers_available > 0:
                new_daily_target = frappe.utils.ceil(row.total_work / (new_days_needed * row.workers_available))
                row.adjusted_daily_target = new_daily_target
    
    def calculate_totals(self):
        """Calculate plan totals"""
        total_workers_planned = 0
        
        for row in self.get("entries", []):
            total_workers_planned += flt(row.workers_assigned) or 0
        
        self.total_workers_planned = total_workers_planned
    
    def validate_worker_allocation(self):
        """Ensure worker allocation doesn't exceed approved count"""
        if not self.no_of_approved_workers:
            return
            
        assigned = 0
        for row in self.get("entries", []):
            if row.task_worker:
                assigned += 1
        
        if assigned > self.no_of_approved_workers:
            frappe.throw(_("Cannot assign {0} employees. Only {1} workers approved.").format(
                assigned, self.no_of_approved_workers))


    def create_notification(self, action):
        """Create notification for plan action"""
        subject = f"Task Work Plan {self.name} {action}"
        message = f"""
            <p>Task Work Plan <strong>{self.name}</strong> has been {action}.</p>
            <p><strong>Title:</strong> {self.title}</p>
            <p><strong>Manager:</strong> {self.managers_name}</p>
            <p><strong>Approved Workers:</strong> {self.no_of_approved_workers}</p>
            <p><strong>Understaffed Tasks:</strong> {self.understaffed_tasks or 0}</p>
        """
        
        # Notify farm manager
        if self.managers_name:
            user_id = frappe.db.get_value("Employee", self.managers_name, "user_id")
            if user_id:
                frappe.sendmail(
                    recipients=[user_id],
                    subject=subject,
                    message=message
                )
    
    def _send_workflow_notification(self):
        """Send workflow state change notifications"""
        prev = self.get_doc_before_save()
        if not prev:
            return
            
        prev_state = prev.get("workflow_state") or ""
        curr_state = self.workflow_state or ""
        
        if prev_state == curr_state:
            return

        doc_link = frappe.utils.get_url_to_form(self.doctype, self.name)
        subject_base = f"Task Work Plan: {self.name}"

        def notify_role(role, msg):
            self._send_to_role(role, f"{subject_base} – {msg}", self._build_body(msg, doc_link),
                               company=self.company)

        def notify_owner(msg):
            self._send_to_user(self.owner, f"{subject_base} – {msg}", self._build_body(msg, doc_link))

        def notify_farm_manager(msg):
            if self.managers_name:
                user = frappe.db.get_value("Employee", self.managers_name, "user_id")
                if user:
                    self._send_to_user(user, f"{subject_base} – {msg}", self._build_body(msg, doc_link))

        transitions = {
            "Pending Approval": lambda: notify_role(
                "General Manager", "Task Work Plan pending your approval"
            ),
            "Approved": lambda: (
                notify_owner("Task Work Plan approved"),
                notify_farm_manager("Your Task Work Plan has been approved")
            ),
            "Rejected": lambda: notify_owner("Task Work Plan rejected"),
        }

        action = transitions.get(curr_state)
        if action:
            action()
    
    def _send_to_role(self, role, subject, body, company=None):
        """Send email to users with *role*, scoped to *company* when supplied."""
        for user in _get_users_for_role_and_company(role, company):
            self._send_to_user(user, subject, body)

    def _send_to_user(self, user, subject, body):
        """Send email to specific user"""
        if not user:
            return
        _shared_send_to_user(user, subject, body)

    def _build_body(self, message, link):
        """Build email body"""
        return f"""
        <p>Hello,</p>
        <p><strong>{message}</strong></p>
        <ul>
            <li><strong>Document:</strong> {self.name}</li>
            <li><strong>Title:</strong> {self.get('title') or self.name}</li>
            <li><strong>Status:</strong> {self.workflow_state or ''}</li>
            <li><strong>Manager:</strong> {self.managers_name}</li>
            <li><strong>Approved Workers:</strong> {self.no_of_approved_workers}</li>
            <li><strong>Understaffed Tasks:</strong> {self.understaffed_tasks or 0}</li>
        </ul>
        <p><a href="{link}">View Document</a></p>
        <p>Regards,<br>Upande HR System</p>
        """


@frappe.whitelist()
def get_cost_centre_for_manager(manager_id):
    """Return the best-matching Cost Centre for an Employee."""
    emp = frappe.db.get_value(
        "Employee", manager_id,
        ["custom_business_unit", "custom_farm", "company"],
        as_dict=True,
    )
    if not emp or not emp.company:
        return None

    abbr = frappe.db.get_value("Company", emp.company, "abbr")
    if not abbr:
        return None

    if emp.custom_farm:
        cc = f"{emp.custom_farm} - {abbr}"
        if frappe.db.exists("Cost Center", cc):
            return cc

    bu = emp.custom_business_unit
    if bu and bu != emp.company:
        cc = f"{bu} - {abbr}"
        if frappe.db.exists("Cost Center", cc):
            return cc

    return None


@frappe.whitelist()
def check_worker_availability(plan_name, tasks, unit=None, start_date=None):
    """Check available workers for each task based on unit and date"""
    if isinstance(tasks, str):
        tasks = json.loads(tasks)
    
    availability_data = []
    
    # Get total active workers in the unit
    worker_filters = {"status": "Active"}
    
    total_workers = frappe.db.count("Task Worker", filters=worker_filters)
    
    for task in tasks:
        if not task.get('task_name'):
            continue
        
        task_name = task.get('task_name')
        workers_needed = task.get('workers_required') or task.get('workers', 1)
        task_start = task.get('start_date') or start_date
        task_end = task.get('end_date')
        
        # Get workers already assigned during this period
        assigned_workers = 0
        if task_start and task_end and plan_name:
            assigned_workers = frappe.db.sql("""
                SELECT COUNT(DISTINCT tp.task_worker)
                FROM `tabTask Plan` tp
                WHERE tp.parent = %s
                    AND tp.start_date <= %s
                    AND tp.end_date >= %s
                    AND tp.task_worker IS NOT NULL
            """, (plan_name, task_end, task_start))[0][0]
        
        workers_available = max(0, total_workers - assigned_workers)
        
        # Calculate required days based on available workers
        required_days = 1
        if workers_available > 0 and task.get('total_work') and task.get('daily_target'):
            total_work = flt(task.get('total_work'))
            daily_target = flt(task.get('daily_target'))
            daily_capacity = daily_target * workers_available
            if daily_capacity > 0:
                required_days = frappe.utils.ceil(total_work / daily_capacity)
        
        availability_data.append({
            'task_name': task_name,
            'workers_needed': workers_needed,
            'workers_available': workers_available,
            'start_date': task_start,
            'end_date': task_end,
            'daily_target': task.get('daily_target'),
            'total_work': task.get('total_work'),
            'payment_type': task.get('payment_type'),
            'rate': task.get('rate'),
            'required_days': required_days
        })
    
    return availability_data


@frappe.whitelist()
def get_worker_schedule(plan_name, start_date, end_date):
    """Get worker assignments for scheduling"""
    assignments = frappe.db.sql("""
        SELECT
            tp.task_worker as worker,
            tp.task_name,
            tp.start_date,
            tp.end_date
        FROM `tabTask Plan` tp
        WHERE tp.parent = %s
            AND tp.start_date BETWEEN %s AND %s
            AND tp.task_worker IS NOT NULL
        ORDER BY tp.start_date
    """, (plan_name, start_date, end_date), as_dict=True)
    
    return assignments


@frappe.whitelist()
def calculate_task_duration(total_work, daily_target, workers_available):
    """Calculate required days for a task based on available workers"""
    if not total_work or not daily_target or not workers_available:
        return 1
    
    total_work = flt(total_work)
    daily_target = flt(daily_target)
    workers_available = int(workers_available)
    
    daily_capacity = daily_target * workers_available
    if daily_capacity <= 0:
        return 1
    
    days_needed = frappe.utils.ceil(total_work / daily_capacity)
    return days_needed


@frappe.whitelist()
def optimize_task_sequence(tasks_json):
    """Optimize task sequence based on dependencies and dates"""
    if isinstance(tasks_json, str):
        tasks = json.loads(tasks_json)
    else:
        tasks = tasks_json
    
    if not tasks:
        return []
    
    # Sort tasks by priority and start date
    sorted_tasks = sorted(tasks, key=lambda x: (
        -x.get('priority', 0),
        x.get('start_date', ''),
        -x.get('total_work', 0)
    ))
    
    # Adjust dates to avoid overlap
    current_end_date = None
    for task in sorted_tasks:
        if current_end_date and task.get('start_date'):
            task_start = getdate(task.get('start_date'))
            curr_end = getdate(current_end_date)
            
            if task_start <= curr_end:
                # Move task start to after previous task ends
                new_start = add_days(curr_end, 1)
                task['start_date'] = str(new_start)
                
                # Recalculate end date based on duration
                if task.get('days'):
                    task['end_date'] = str(add_days(new_start, task['days'] - 1))
        
        if task.get('end_date'):
            current_end_date = task.get('end_date')
    
    return sorted_tasks


@frappe.whitelist()
def get_worker_workload(plan_name, start_date, end_date):
    """Get workload distribution across workers"""
    workload = frappe.db.sql("""
        SELECT
            tp.task_worker as worker,
            COUNT(*) as task_count,
            SUM(datediff(tp.end_date, tp.start_date) + 1) as total_days,
            GROUP_CONCAT(tp.task_name SEPARATOR ', ') as tasks
        FROM `tabTask Plan` tp
        WHERE tp.parent = %s
            AND tp.start_date BETWEEN %s AND %s
            AND tp.task_worker IS NOT NULL
        GROUP BY tp.task_worker
    """, (plan_name, start_date, end_date), as_dict=True)
    
    return workload


@frappe.whitelist()
def get_understaffing_summary(plan_name):
    """Get summary of understaffed tasks"""
    plan = frappe.get_doc("Task Work Plan", plan_name)
    
    understaffed = []
    for row in plan.entries:
        if row.understaffed:
            understaffed.append({
                "task": row.task_name,
                "required": row.workers_required,
                "available": row.workers_available,
                "shortage": row.workers_required - row.workers_available,
                "start_date": row.start_date,
                "end_date": row.end_date,
                "original_days": date_diff(row.end_date, row.start_date) + 1 if row.start_date and row.end_date else 0
            })
    
    return {
        "total_understaffed": len(understaffed),
        "tasks": understaffed,
        "total_shortage": sum([t["shortage"] for t in understaffed])
    }


@frappe.whitelist()
def create_assignment_from_plan(plan_name):
    """Create a Task Work Assignment from a Plan"""
    plan = frappe.get_doc("Task Work Plan", plan_name)
    
    # Create new assignment
    assignment = frappe.new_doc("Task Work Assignment")
    assignment.task_work_plan = plan.name
    assignment.task_work_request = plan.task_work_request_ref
    assignment.title = plan.title
    assignment.farm_manager = plan.managers_name
    assignment.unitdivision = plan.unitdivision
    assignment.business_unit = plan.business_unit
    assignment.company = plan.company
    assignment.cost_centre = plan.cost_centre
    assignment.start_date = plan.custom_expected_start_date
    
    # Copy task details from plan entries
    for plan_row in plan.entries:
        row = assignment.append("task_details", {})
        row.task_name = plan_row.task_name
        row.workers = plan_row.workers_assigned
        row.start_date = plan_row.start_date
        row.end_date = plan_row.end_date
        row.daily_target = plan_row.daily_target
        row.total_work = plan_row.total_work
        row.payment_type = plan_row.payment_type
        row.rate = plan_row.rate
        row.uom = plan_row.uom
        row.estimated_cost = plan_row.total_work * plan_row.rate if plan_row.total_work and plan_row.rate else 0
    
    assignment.flags.ignore_permissions = True
    assignment.insert()
    
    return assignment.name


@frappe.whitelist()
def get_timeline_impact(plan_name):
    """Calculate timeline impact of understaffing"""
    plan = frappe.get_doc("Task Work Plan", plan_name)
    
    original_end_date = None
    adjusted_end_date = None
    total_delay = 0
    
    for row in plan.entries:
        if row.start_date and row.end_date:
            if not original_end_date or getdate(row.end_date) > getdate(original_end_date):
                original_end_date = row.end_date
    
    # Check if understaffing caused delays
    understaffed_tasks = [r for r in plan.entries if r.understaffed]
    
    if understaffed_tasks:
        latest_end = None
        for task in understaffed_tasks:
            if task.end_date and (not latest_end or getdate(task.end_date) > getdate(latest_end)):
                latest_end = task.end_date
        
        adjusted_end_date = latest_end
        if original_end_date and adjusted_end_date:
            total_delay = date_diff(adjusted_end_date, original_end_date)
    
    return {
        "original_completion": original_end_date,
        "adjusted_completion": adjusted_end_date,
        "total_delay_days": max(0, total_delay),
        "understaffed_count": len(understaffed_tasks)
    }
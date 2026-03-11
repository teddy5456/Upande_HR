# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, today, getdate, add_days, now_datetime

class TaskWorkRequest(Document):
    def validate(self):
        # Reset stage when a cancelled document is amended (draft copy)
        if self.amended_from and self.docstatus == 0:
            self.stage = "Requested"
        self.validate_dates()
        self.calculate_totals()
        self.validate_workers()
        
    def on_submit(self):
        self.db_set("stage", "Requested")
        self.create_workflow_notification("submitted")

    def on_cancel(self):
        self.db_set("stage", "Cancelled")
        
    def on_update(self):
        self._send_workflow_notification()
        
    def validate_dates(self):
        """Validate that dates are logical"""
        # Check if custom_expected_start_date and custom_expected_end_date exist
        if hasattr(self, 'custom_expected_start_date') and hasattr(self, 'custom_expected_end_date'):
            if self.custom_expected_start_date and self.custom_expected_end_date:
                if getdate(self.custom_expected_end_date) < getdate(self.custom_expected_start_date):
                    frappe.throw(_("Expected end date cannot be before expected start date"))
    
    def calculate_totals(self):
        """Calculate total cost and workers"""
        total_cost = 0
        total_workers = 0
        
        for row in self.get("task_request_details", []):
            total_workers += flt(row.workers) or 0
            total_cost += flt(row.estimated_cost) or 0
        
        self.total_workers = total_workers
        self.estimated_cost = total_cost
    
    def validate_workers(self):
        """Ensure worker count is reasonable"""
        for row in self.get("task_request_details", []):
            if row.workers and row.workers < 1:
                frappe.throw(_("Row #{0}: Worker count must be at least 1").format(row.idx))
    
    def create_workflow_notification(self, action):
        """Create notification for workflow action"""
        subject = f"Task Work Request {self.name} {action}"
        message = f"""
            <p>Task Work Request <strong>{self.name}</strong> has been {action}.</p>
            <p><strong>Title:</strong> {self.title}</p>
            <p><strong>Manager:</strong> {self.farm_managers_name}</p>
            <p><strong>Total Cost:</strong> {self.estimated_cost}</p>
            <p><strong>Total Workers:</strong> {self.total_workers}</p>
        """
        
        # Notify farm manager
        if self.farm_managers_name:
            user_id = frappe.db.get_value("Employee", self.farm_managers_name, "user_id")
            if user_id:
                try:
                    frappe.sendmail(
                        recipients=[user_id],
                        subject=subject,
                        message=message
                    )
                except:
                    frappe.log_error(frappe.get_traceback(), "Failed to send notification")
    
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
        subject_base = f"Task Work Request: {self.name}"

        def notify_role(role, msg):
            self._send_to_role(role, f"{subject_base} – {msg}", self._build_body(msg, doc_link),
                               company=self.company)

        def notify_owner(msg):
            self._send_to_user(self.owner, f"{subject_base} – {msg}", self._build_body(msg, doc_link))

        def notify_farm_manager(msg):
            if self.farm_managers_name:
                user = frappe.db.get_value("Employee", self.farm_managers_name, "user_id")
                if user:
                    self._send_to_user(user, f"{subject_base} – {msg}", self._build_body(msg, doc_link))

        transitions = {
            "Awaiting Approval from General Manager": lambda: notify_role(
                "General Manager", "Pending your approval"
            ),
            "Approved by General Manager": lambda: (
                notify_owner("Approved by General Manager – Pending HR review"),
                notify_role("HR Manager", "Pending your review")
            ),
            "Rejected by General Manager": lambda: notify_owner("Rejected by General Manager"),
            "Approved by HR": lambda: (
                notify_owner("Approved by HR – Request is fully approved"),
                notify_farm_manager("Your Task Work Request has been approved")
            ),
            "Rejected by HR": lambda: notify_owner("Rejected by HR"),
        }

        action = transitions.get(curr_state)
        if action:
            action()
    
    def _send_to_role(self, role, subject, body, company=None):
        _send_to_role(role, subject, body, company=company)

    def _send_to_user(self, user, subject, body):
        _send_to_user(user, subject, body)

    def _build_body(self, message, link):
        return _build_body(self, message, link)


# When a company-specific role exists for a base role, use it directly.
# Otherwise, the base role's users are filtered by their employee's company.
_COMPANY_ROLE_MAP = {
    ("General Manager", "Kaitet Limited"): "General Manager Kaitet",
}


def _get_users_for_role_and_company(base_role, company=None):
    """Return enabled users with *base_role*, scoped to *company*.

    Priority:
    1. A dedicated company-specific role exists in _COMPANY_ROLE_MAP  → use it.
    2. Filter the base-role's users to those whose Employee record belongs
       to *company*.
    3. Fallback: return all enabled users with the base role when no
       company-scoped match is found.
    """
    if company:
        specific_role = _COMPANY_ROLE_MAP.get((base_role, company))
        if specific_role:
            users = frappe.get_all("Has Role", filters={"role": specific_role}, pluck="parent")
            users = list(set(users))
            return frappe.get_all("User", filters={"name": ["in", users], "enabled": 1}, pluck="name")

    # All enabled users with the base role
    users = frappe.get_all("Has Role", filters={"role": base_role}, pluck="parent")
    users = list(set(users))
    enabled = frappe.get_all("User", filters={"name": ["in", users], "enabled": 1}, pluck="name")

    if not company:
        return enabled

    # Filter by the user's linked Employee company
    company_users = [
        u for u in enabled
        if frappe.db.get_value("Employee", {"user_id": u}, "company") == company
    ]
    return company_users if company_users else enabled  # graceful fallback


def _send_to_role(role, subject, body, company=None):
    """Send email to users with *role*, limited to *company* when supplied."""
    for user in _get_users_for_role_and_company(role, company):
        _send_to_user(user, subject, body)


def _send_to_user(user, subject, body):
    """Send email to specific user"""
    if not user:
        return
    email = frappe.db.get_value("User", user, "email") or user
    try:
        frappe.sendmail(recipients=[email], subject=subject, message=body, delayed=False)
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"Task Work notification failed: {subject}")


def _build_body(doc, message, link):
    """Build email body"""
    return f"""
        <p>Hello,</p>
        <p><strong>{message}</strong></p>
        <ul>
            <li><strong>Document:</strong> {doc.name}</li>
            <li><strong>Title:</strong> {doc.get('title') or doc.name}</li>
            <li><strong>Status:</strong> {doc.get('workflow_state') or ''}</li>
            <li><strong>Date:</strong> {doc.get('posting_date') or ''}</li>
        </ul>
        <p><a href="{link}">View Document</a></p>
        <p>Regards,<br>Upande HR System</p>
        """


@frappe.whitelist()
def get_task_request_details(request_name):
    """Get details of a task work request"""
    request = frappe.get_doc("Task Work Request", request_name)
    
    details = []
    for row in request.task_request_details:
        detail = {
            "task_name": row.task_name,
            "total_work": row.total_work,
            "daily_target": row.daily_target,
            "workers": row.workers,
            "payment_type": row.payment_type,
            "rate": row.rate,
            "estimated_cost": row.estimated_cost,
            "uom": row.uom,
            "task": row.task
        }
        
        # Add optional fields if they exist
        if hasattr(row, 'start_date'):
            detail["start_date"] = row.start_date
        if hasattr(row, 'end_date'):
            detail["end_date"] = row.end_date
        if hasattr(row, 'days'):
            detail["days"] = row.days
        if hasattr(row, 'per_worker_payment'):
            detail["per_worker_payment"] = row.per_worker_payment
            
        details.append(detail)
    
    return {
        "name": request.name,
        "title": request.title,
        "farm_manager": request.farm_managers_name,
        "unit": request.unitdivision,
        "business_unit": request.business_unit,
        "company": request.company,
        "total_workers": request.total_workers,
        "estimated_cost": request.estimated_cost,
        "details": details
    }


@frappe.whitelist()
def calculate_payment_breakdown(request_name):
    """Calculate payment breakdown by type"""
    request = frappe.get_doc("Task Work Request", request_name)
    
    breakdown = {
        "per_unit": {"count": 0, "total": 0},
        "per_day": {"count": 0, "total": 0},
        "per_task": {"count": 0, "total": 0}
    }
    
    for row in request.task_request_details:
        if row.payment_type == "Per Unit":
            breakdown["per_unit"]["count"] += 1
            breakdown["per_unit"]["total"] += flt(row.estimated_cost)
        elif row.payment_type == "Per Day":
            breakdown["per_day"]["count"] += 1
            breakdown["per_day"]["total"] += flt(row.estimated_cost)
        elif row.payment_type == "Per Task":
            breakdown["per_task"]["count"] += 1
            breakdown["per_task"]["total"] += flt(row.estimated_cost)
    
    return breakdown


@frappe.whitelist()
def validate_request_dates(request_name):
    """Validate all dates in a request"""
    request = frappe.get_doc("Task Work Request", request_name)
    
    issues = []
    
    # Check expected dates if they exist
    if hasattr(request, 'custom_expected_start_date') and hasattr(request, 'custom_expected_end_date'):
        if request.custom_expected_start_date and request.custom_expected_end_date:
            if getdate(request.custom_expected_end_date) < getdate(request.custom_expected_start_date):
                issues.append("Expected end date before expected start date")
    
    return {
        "valid": len(issues) == 0,
        "issues": issues
    }


@frappe.whitelist()
def create_plan_from_request(request_name):
    """Create a Task Work Plan from a Request"""
    request = frappe.get_doc("Task Work Request", request_name)
    
    # Create new plan
    plan = frappe.new_doc("Task Work Plan")
    plan.task_work_request_ref = request.name
    plan.title = request.name
    plan.managers_name = request.farm_managers_name
    plan.unitdivision = request.unitdivision
    plan.business_unit = request.business_unit
    plan.company = request.company
    plan.no_of_approved_workers = request.total_workers
    plan.approved_estimated_cost = request.estimated_cost
    
    # Set expected start date if available
    if hasattr(request, 'custom_expected_start_date'):
        plan.custom_expected_start_date = request.custom_expected_start_date
    
    # Copy request details
    for req_row in request.task_request_details:
        row = plan.append("entries", {})
        row.task_name = req_row.task_name
        row.workers_required = req_row.workers
        row.daily_target = req_row.daily_target
        row.total_work = req_row.total_work
        row.payment_type = req_row.payment_type
        row.rate = req_row.rate
        row.uom = req_row.uom
        row.workers_available = request.total_workers
        row.workers_assigned = min(request.total_workers, req_row.workers)
        
        # Copy date fields if they exist
        if hasattr(req_row, 'start_date'):
            row.start_date = req_row.start_date
        if hasattr(req_row, 'end_date'):
            row.end_date = req_row.end_date
    
    plan.flags.ignore_permissions = True
    plan.insert()
    
    return plan.name
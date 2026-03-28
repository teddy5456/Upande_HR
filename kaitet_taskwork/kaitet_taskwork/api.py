# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

"""
Server-side helpers for employee add/replace and suggestion workflows.
"""

import frappe
from frappe import _
from frappe.utils import today, flt


@frappe.whitelist()
def apply_employee_change(assignment_name, new_worker, task, old_worker=None, reason=None):
    """
    Add or replace a worker in a TW Assignment's worker_assignments table.

    - If old_worker is supplied every row for that worker on *task* is
      removed and replaced with the new worker.
    - All rows created here are marked `manually_assigned = 1` so that
      Smart Assign / Auto Assign will never overwrite them.
    - The change is also logged into the linked TW Plan's employee_changes
      child table.

    Returns the number of rows added.
    """
    assignment = frappe.get_doc("Task Work Assignment", assignment_name)
    change_type = "Replace Employee" if old_worker else "Add Employee"

    # -- Gather task defaults from task_details ---------------------------------
    task_row = next((r for r in assignment.task_details if r.task == task), None)

    rows_added = 0

    if old_worker:
        # Collect rows belonging to old_worker on this task
        to_replace = [
            r for r in assignment.worker_assignments
            if r.employee_name == old_worker and r.task == task
        ]
        if not to_replace:
            frappe.throw(_("No assignments found for worker {0} on task {1}").format(
                old_worker, task))

        for old_row in to_replace:
            new_row = assignment.append("worker_assignments", {
                "employee_name":       new_worker,
                "task":                old_row.task,
                "uom":                 old_row.uom,
                "daily_target":        old_row.daily_target,
                "quantity_assigned":   old_row.quantity_assigned,
                "rate":                old_row.rate,
                "total_assigned_cost": old_row.total_assigned_cost,
                "assignment_date":     old_row.assignment_date,
                "days":                old_row.days,
                "location":            old_row.location,
                "manually_assigned":   1,
            })
            assignment.remove(old_row)
            rows_added += 1
    else:
        # Pure add: build a sensible row from task_details defaults
        new_row = assignment.append("worker_assignments", {
            "employee_name":     new_worker,
            "task":              task,
            "uom":               task_row.uom if task_row else None,
            "daily_target":      task_row.daily_target if task_row else None,
            "rate":              task_row.rate if task_row else None,
            "assignment_date":   assignment.start_date or today(),
            "manually_assigned": 1,
        })
        rows_added = 1

    assignment.save(ignore_permissions=True)

    # -- Log change in TW Plan --------------------------------------------------
    if assignment.task_work_plan:
        try:
            plan = frappe.get_doc("Task Work Plan", assignment.task_work_plan)
            plan.append("employee_changes", {
                "change_date":    today(),
                "task":           task,
                "old_employee":   old_worker,
                "new_employee":   new_worker,
                "change_type":    change_type,
                "assignment_ref": assignment_name,
                "changed_by":     frappe.session.user,
                "reason":         reason or "",
            })
            plan.save(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Failed to log employee change in plan")

    return rows_added


@frappe.whitelist()
def sync_suggestions_to_plan(plan_name):
    """
    Copy suggested_employees from the linked TW Request into the TW Plan,
    skipping entries that are already present.
    Returns the count of new entries added.
    """
    plan = frappe.get_doc("Task Work Plan", plan_name)
    if not plan.task_work_request_ref:
        return 0

    request = frappe.get_doc("Task Work Request", plan.task_work_request_ref)
    if not request.suggested_employees:
        return 0

    existing = {
        (r.task_worker, r.task or "") for r in plan.suggested_employees
    }
    added = 0
    for s in request.suggested_employees:
        key = (s.task_worker, s.task or "")
        if key not in existing:
            plan.append("suggested_employees", {
                "task_worker":  s.task_worker,
                "worker_name":  s.worker_name,
                "task":         s.task,
                "notes":        s.notes,
                "selected":     0,
            })
            existing.add(key)
            added += 1

    if added:
        plan.save(ignore_permissions=True)

    return added


@frappe.whitelist()
def use_selected_suggestions(plan_name):
    """
    For each row in TW Plan's suggested_employees where `selected = 1`,
    add the worker into the plan's entries (Task Plan) child table so they
    appear in Smart Assign's worker list and are associated with their task.

    Task defaults (daily_target, total_work, rate, uom, payment_type) are
    pulled from the linked TW Request's task_request_details when available.

    Clears the `selected` flag on processed rows.
    Returns the count of entries added.
    """
    plan = frappe.get_doc("Task Work Plan", plan_name)

    # Build task defaults from the linked request
    task_defaults = {}
    if plan.task_work_request_ref:
        req = frappe.get_doc("Task Work Request", plan.task_work_request_ref)
        for r in req.task_request_details:
            if r.task:
                task_defaults[r.task] = r

    # Track existing (task_worker, task_name) pairs to avoid duplicates
    existing = {(e.task_worker, e.task_name or "") for e in plan.entries}

    added = 0
    for s in plan.suggested_employees:
        if not s.selected:
            continue

        task_name = ""
        if s.task:
            task_name = frappe.db.get_value("Task", s.task, "subject") or s.task

        key = (s.task_worker, task_name)
        if key not in existing:
            td = task_defaults.get(s.task) if s.task else None
            plan.append("entries", {
                "task_worker":      s.task_worker,
                "task_name":        task_name,
                "workers_required": 1,
                "daily_target":     td.daily_target if td else None,
                "total_work":       td.total_work if td else None,
                "rate":             td.rate if td else None,
                "uom":              td.uom if td else None,
                "payment_type":     td.payment_type if td else None,
            })
            existing.add(key)
            added += 1

        s.selected = 0

    if added:
        plan.save(ignore_permissions=True)

    return added


@frappe.whitelist()
def get_assignment_tasks(assignment_name):
    """Return the task list for a TW Assignment (for dialog dropdowns)."""
    tasks = frappe.db.get_all(
        "Task Details",
        filters={"parent": assignment_name, "parenttype": "Task Work Assignment"},
        fields=["task", "task_name"],
    )
    return tasks

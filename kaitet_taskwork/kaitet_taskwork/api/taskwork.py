# Copyright (c) 2026, Upande and contributors
# For license information, please see license.txt

"""
Mobile / external API for the task work module.

Written for a future field app (same pattern as the Kahawa Trail and
Upande Bio apps): authenticate with a Frappe API key/secret token pair
(`Authorization: token <key>:<secret>`) or a session cookie, then call:

    POST /api/method/kaitet_taskwork.kaitet_taskwork.api.taskwork.create_request
    GET  /api/method/kaitet_taskwork.kaitet_taskwork.api.taskwork.list_my_requests
    GET  /api/method/kaitet_taskwork.kaitet_taskwork.api.taskwork.get_form_options
    GET  /api/method/kaitet_taskwork.kaitet_taskwork.api.taskwork.list_assignments
    GET  /api/method/kaitet_taskwork.kaitet_taskwork.api.taskwork.get_assignment
    POST /api/method/kaitet_taskwork.kaitet_taskwork.api.taskwork.submit_actuals

Every call runs as the authenticated user: standard doctype permissions
and the company-isolation query conditions in kaitet_taskwork.permissions
apply unchanged. All responses are plain JSON-serialisable dicts.
"""

import frappe
from frappe.utils import cint, flt, get_datetime, nowdate

from kaitet_taskwork.kaitet_taskwork.permissions import get_user_company


def _get_employee():
    """Employee record linked to the session user (farm managers raise
    requests against their own Employee)."""
    emp = frappe.db.get_value(
        "Employee",
        {"user_id": frappe.session.user, "status": "Active"},
        ["name", "employee_name", "company"],
        as_dict=True,
    )
    return emp


# ---------------------------------------------------------------------------
# Requesting
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_form_options():
    """Lookup data the app needs to render the 'new request' form."""
    company = get_user_company()
    emp = _get_employee()

    tasks = frappe.get_list(
        "Task",
        fields=["name", "subject"],
        order_by="modified desc",
        limit_page_length=200,
    )
    uoms = [u["name"] for u in frappe.get_list("UOM", limit_page_length=200)]
    locations = frappe.get_list(
        "Work Location",
        fields=["name"],
        limit_page_length=100,
    )

    # free-text fields on the doctype — offer recent values as suggestions
    def distinct(field):
        return [
            r[0]
            for r in frappe.db.sql(
                f"""select distinct `{field}` from `tabTask Work Request`
                    where ifnull(`{field}`, '') != '' order by modified desc limit 20"""
            )
        ]

    return {
        "employee": emp,
        "company": company,
        "tasks": tasks,
        "uoms": uoms,
        "work_locations": [l["name"] for l in locations],
        "business_units": distinct("business_unit"),
        "unit_divisions": distinct("unitdivision"),
    }


@frappe.whitelist()
def create_request(title, items, unitdivision=None, business_unit=None, submit=0):
    """Create a Task Work Request from the app.

    Args:
        title: unique request title (the document is named by it).
        items: list of dicts, one per task line:
            {task, uom, workers, days, daily_target, total_work, rate}
        unitdivision / business_unit: free-text organisational fields.
        submit: 1 to submit immediately (making it visible on the hub
            inbox as "awaiting a plan"), 0 to leave as draft.

    Returns {name, stage, docstatus, estimated_cost, total_workers}.
    """
    if not frappe.has_permission("Task Work Request", "create"):
        frappe.throw(frappe._("Not permitted to create Task Work Requests"), frappe.PermissionError)

    items = frappe.parse_json(items) or []
    if not items:
        frappe.throw(frappe._("At least one task line is required"))

    title = (title or "").strip()
    if not title:
        frappe.throw(frappe._("Title is required"))
    if frappe.db.exists("Task Work Request", title):
        frappe.throw(frappe._("A request titled {0} already exists — choose another title").format(frappe.bold(title)))

    emp = _get_employee()
    if not emp:
        frappe.throw(frappe._("Your user {0} is not linked to an active Employee record").format(frappe.session.user))

    doc = frappe.new_doc("Task Work Request")
    doc.title = title
    doc.farm_managers_name = emp.name
    doc.unitdivision = unitdivision
    doc.business_unit = business_unit
    doc.company = emp.company or get_user_company()
    doc.posting_date = frappe.utils.now()
    doc.stage = "Requested"

    for item in items:
        row = doc.append("task_request_details", {})
        row.task = item.get("task")
        row.uom = item.get("uom")
        row.workers = cint(item.get("workers"))
        row.days = cint(item.get("days"))
        row.daily_target = cint(item.get("daily_target"))
        row.total_work = cint(item.get("total_work"))
        row.rate = flt(item.get("rate"))
        row.estimated_cost = flt(item.get("rate")) * cint(item.get("total_work"))

    doc.insert()
    if cint(submit):
        doc.submit()

    return {
        "name": doc.name,
        "stage": doc.stage,
        "docstatus": doc.docstatus,
        "estimated_cost": flt(doc.estimated_cost),
        "total_workers": cint(doc.total_workers),
    }


@frappe.whitelist()
def list_my_requests(stage=None, limit=20):
    """Requests raised by the calling user's Employee, newest first."""
    emp = _get_employee()
    filters = {"farm_managers_name": emp.name if emp else "__none__"}
    if stage:
        filters["stage"] = stage
    return frappe.get_list(
        "Task Work Request",
        filters=filters,
        fields=[
            "name", "title", "stage", "docstatus", "posting_date",
            "business_unit", "unitdivision", "estimated_cost", "total_workers", "modified",
        ],
        order_by="modified desc",
        limit_page_length=cint(limit) or 20,
    )


# ---------------------------------------------------------------------------
# Actuals
# ---------------------------------------------------------------------------

@frappe.whitelist()
def list_assignments(stage=None, modified_after=None, limit=50):
    """Assignments visible to the calling user, for the app's work list.

    modified_after (ISO datetime) enables incremental sync — pass the
    timestamp of the previous pull to receive only changed documents.
    """
    filters = {"docstatus": ("<", 2)}
    if stage:
        filters["stage"] = stage
    else:
        filters["stage"] = ("in", ("Pending", "In Progress"))
    if modified_after:
        filters["modified"] = (">", get_datetime(modified_after))

    rows = frappe.get_list(
        "Task Work Assignment",
        filters=filters,
        fields=[
            "name", "title", "stage", "docstatus", "farm_manager",
            "business_unit", "unitdivision", "start_date", "completion_date",
            "expected_start_date", "expected_end_date",
            "total_estimated_cost", "modified",
        ],
        order_by="modified desc",
        limit_page_length=cint(limit) or 50,
    )

    names = [r["name"] for r in rows]
    crew = frappe.get_all(
        "Worker Assignments",
        filters={"parent": ("in", names), "parenttype": "Task Work Assignment"},
        fields=[
            "parent", "name", "task", "employee_name", "worker_full_name", "uom",
            "quantity_assigned", "days", "rate",
            "actual_quantity", "actual_cost", "achievement",
        ],
    ) if names else []
    crew_by_parent = {}
    for c in crew:
        crew_by_parent.setdefault(c.pop("parent"), []).append(c)
    for r in rows:
        r["crew"] = crew_by_parent.get(r["name"], [])

    return {"server_time": frappe.utils.now(), "assignments": rows}


@frappe.whitelist()
def get_assignment(assignment_name):
    """One assignment with its crew rows — same payload the hub editor uses."""
    from kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub import (
        get_assignment_actuals,
    )

    return get_assignment_actuals(assignment_name)


@frappe.whitelist()
def submit_actuals(assignment_name, actuals):
    """Record actual quantities from the app.

    actuals: {<crew row name>: <actual quantity>} — row names come from
    list_assignments / get_assignment. Validation matches the hub and
    the desk form (achievement math + per-task total guard).
    """
    from kaitet_taskwork.kaitet_taskwork.page.task_work_hub.task_work_hub import (
        save_actuals,
    )

    return save_actuals(assignment_name, actuals)

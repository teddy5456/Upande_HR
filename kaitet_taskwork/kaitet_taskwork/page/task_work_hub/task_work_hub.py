# Copyright (c) 2026, Upande and contributors
# For license information, please see license.txt

"""
Server side of the Task Work Hub desk page.

get_hub_data() returns the entire hub state in one call so the page renders
with a single round-trip.  All list queries go through frappe.get_list so the
company-isolation hooks in kaitet_taskwork.permissions keep applying.
"""

import frappe
from frappe.utils import (
    add_days,
    cint,
    date_diff,
    flt,
    getdate,
    nowdate,
    pretty_date,
)

ACTIVE_ASSIGNMENT_STAGES = ("Pending", "In Progress")


@frappe.whitelist()
def get_hub_data():
    today = getdate(nowdate())
    week_start = add_days(today, -today.weekday())          # Monday
    week_end = add_days(week_start, 6)                      # Sunday

    requests = _get_requests()
    plans = _get_plans()
    assignments = _get_assignments(today)
    change_requests = _get_change_requests()
    disbursements = _get_disbursements(today)
    workers = _get_workers()

    return {
        "today": str(today),
        "week": {
            "number": today.isocalendar()[1],
            "start": str(week_start),
            "end": str(week_end),
        },
        "kpis": _build_kpis(requests, plans, assignments, change_requests, disbursements, workers),
        "inbox": _build_inbox(requests, plans, change_requests, disbursements),
        "pipeline": _build_pipeline(requests, plans, assignments, disbursements),
        "assignments": assignments,
        "workers": workers,
        "disbursements": disbursements,
        "cost_trend": _build_cost_trend(),
        "top_tasks": _build_top_tasks(assignments),
    }


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def _get_requests():
    rows = frappe.get_list(
        "Task Work Request",
        filters={"docstatus": 1, "stage": "Requested"},
        fields=[
            "name", "title", "farm_managers_name", "unitdivision", "business_unit",
            "posting_date", "estimated_cost", "total_workers", "modified",
        ],
        order_by="posting_date asc",
        limit_page_length=20,
    )
    drafts = frappe.get_list(
        "Task Work Request",
        filters={"docstatus": 0},
        fields=[
            "name", "title", "farm_managers_name", "unitdivision", "business_unit",
            "posting_date", "estimated_cost", "total_workers", "modified",
        ],
        order_by="modified desc",
        limit_page_length=5,
    )
    for r in rows:
        r["is_draft"] = 0
    for r in drafts:
        r["is_draft"] = 1
    return rows + drafts


def _get_plans():
    rows = frappe.get_list(
        "Task Work Plan",
        filters={"docstatus": ("<", 2), "stage": "Planned"},
        fields=[
            "name", "title", "managers_name", "business_unit", "docstatus",
            "total_workers_planned", "understaffed_tasks", "approved_estimated_cost",
            "custom_expected_start_date", "task_work_request_ref", "modified",
        ],
        order_by="modified desc",
        limit_page_length=20,
    )
    return rows


def _get_assignments(today):
    rows = frappe.get_list(
        "Task Work Assignment",
        filters={"docstatus": 1, "stage": ("in", ACTIVE_ASSIGNMENT_STAGES)},
        fields=[
            "name", "title", "stage", "farm_manager", "business_unit", "unitdivision",
            "total_estimated_cost", "start_date", "completion_date",
            "expected_start_date", "expected_end_date", "modified",
        ],
        order_by="start_date asc",
        limit_page_length=50,
    )
    if not rows:
        return rows

    names = [r["name"] for r in rows]
    crew = frappe.get_all(
        "Worker Assignments",
        filters={"parent": ("in", names), "parenttype": "Task Work Assignment"},
        fields=[
            "parent", "employee_name", "worker_full_name",
            "total_assigned_cost", "actual_cost",
        ],
    )
    crew_by_parent = {}
    for c in crew:
        crew_by_parent.setdefault(c.parent, []).append(c)

    for r in rows:
        members = crew_by_parent.get(r["name"], [])
        r["crew"] = len(members)
        r["crew_names"] = [m.worker_full_name or m.employee_name for m in members][:6]
        assigned = sum(flt(m.total_assigned_cost) for m in members)
        actual = sum(flt(m.actual_cost) for m in members)
        est = flt(r.get("total_estimated_cost")) or assigned
        r["spend"] = actual or assigned
        r["spend_pct"] = round(r["spend"] / est * 100) if est else 0

        start = r.get("start_date") or r.get("expected_start_date")
        end = r.get("expected_end_date") or r.get("completion_date")
        if start and end:
            r["days_total"] = max(date_diff(end, start) + 1, 1)
            r["day"] = min(max(date_diff(today, start) + 1, 0), r["days_total"])
        else:
            r["days_total"] = 0
            r["day"] = 0
        r["ends_soon"] = bool(end and 0 <= date_diff(end, today) <= 3)
    return rows


def _get_change_requests():
    return frappe.get_list(
        "TW Employee Change Request",
        filters={"status": "Pending HR Approval"},
        fields=[
            "name", "title", "change_type", "task_work_assignment",
            "old_employee", "new_employee", "reason", "request_date", "modified",
        ],
        order_by="modified desc",
        limit_page_length=20,
    )


def _get_disbursements(today):
    year = today.year
    rows = frappe.get_list(
        "TW Weekly Disbursement",
        filters={"docstatus": ("<", 2), "year": year},
        fields=[
            "name", "year", "week_number", "week_start_date", "week_end_date",
            "status", "docstatus", "total_workers", "total_gross",
            "total_deductions", "total_net", "payment_date", "journal_entry", "modified",
        ],
        order_by="week_number asc",
        limit_page_length=60,
    )

    latest = None
    unpaid = [r for r in rows if r["status"] not in ("Paid", "Cancelled", "Rejected")]
    if unpaid:
        latest = unpaid[-1]
    elif rows:
        latest = rows[-1]

    entries = []
    if latest:
        entries = frappe.get_all(
            "TW Disbursement Entry",
            filters={"parent": latest["name"], "parenttype": "TW Weekly Disbursement"},
            fields=[
                "task_worker", "worker_name", "payment_method", "bank_or_mpesa",
                "gross_amount", "deductions", "net_amount", "paid",
            ],
            order_by="net_amount desc",
        )

    return {
        "year": year,
        "current_week": today.isocalendar()[1],
        "list": rows,
        "latest": latest,
        "entries": entries,
    }


def _get_workers():
    fields = [
        "name", "full_name", "payroll_number", "id_number", "status",
        "payment_method", "phone", "mpesa_phone", "account_number",
        "photo", "current_assignment", "modified", "creation",
    ]
    rows = frappe.get_list(
        "Task Worker",
        fields=fields,
        order_by="modified desc",
        limit_page_length=0,
    )

    active = [r for r in rows if r["status"] == "Active"]
    mix = {}
    for r in active:
        mix[r["payment_method"] or "Unset"] = mix.get(r["payment_method"] or "Unset", 0) + 1

    def pct(cond):
        return round(sum(1 for r in active if cond(r)) / len(active) * 100) if active else 0

    health = {
        "M-Pesa number": pct(lambda r: r.get("mpesa_phone") or r.get("payment_method") != "M-Pesa"),
        "ID number on file": pct(lambda r: r.get("id_number")),
        "Photo on file": pct(lambda r: r.get("photo")),
        "Bank details": pct(lambda r: r.get("account_number") or r.get("payment_method") != "Bank Transfer"),
        "Phone on file": pct(lambda r: r.get("phone")),
    }

    return {
        "total": len(rows),
        "active": len(active),
        "assigned": sum(1 for r in active if r.get("current_assignment")),
        "cards": rows[:12],
        "payment_mix": mix,
        "health": health,
    }


# ---------------------------------------------------------------------------
# Derived blocks
# ---------------------------------------------------------------------------

def _build_kpis(requests, plans, assignments, change_requests, disbursements, workers):
    submitted_requests = [r for r in requests if not r["is_draft"]]
    unpaid = [
        d for d in disbursements["list"]
        if d["status"] not in ("Paid", "Cancelled", "Rejected")
    ]
    understaffed = sum(cint(p.get("understaffed_tasks")) for p in plans)
    week_cost = sum(flt(a.get("total_estimated_cost")) for a in assignments)

    return {
        "workers_assigned": workers["assigned"],
        "workers_active": workers["active"],
        "active_assignments": len(assignments),
        "ending_soon": sum(1 for a in assignments if a.get("ends_soon")),
        "week_cost": week_cost,
        "understaffed_tasks": understaffed,
        "pending_requests": len(submitted_requests),
        "pending_plans": len(plans),
        "pending_changes": len(change_requests),
        "unpaid_weeks": len(unpaid),
        "unpaid_net": sum(flt(d.get("total_net")) for d in unpaid),
        "unpaid_label": ", ".join(f"wk {d['week_number']}" for d in unpaid[:3]),
    }


def _build_inbox(requests, plans, change_requests, disbursements):
    inbox = []

    for d in disbursements["list"]:
        if d["status"] in ("Paid", "Cancelled", "Rejected"):
            continue
        inbox.append({
            "kind": "payment",
            "title": f"Week {d['week_number']} disbursement {d['status'].lower()} · KES {flt(d['total_net']):,.0f} net",
            "meta": f"{d['name']} · {cint(d['total_workers'])} workers",
            "age": pretty_date(d["modified"]),
            "action": {"label": "Open Payment", "type": "route", "doctype": "TW Weekly Disbursement", "name": d["name"]},
        })

    for r in requests:
        if r["is_draft"]:
            inbox.append({
                "kind": "draft",
                "title": f"Draft request · {r['title'] or r['name']}",
                "meta": f"{r['name']} · {r.get('farm_managers_name') or ''} · est. KES {flt(r.get('estimated_cost')):,.0f}",
                "age": pretty_date(r["modified"]),
                "action": {"label": "Complete & Submit", "type": "route", "doctype": "Task Work Request", "name": r["name"]},
            })
        else:
            inbox.append({
                "kind": "request",
                "title": f"{r['title'] or r['name']} · {cint(r.get('total_workers'))} workers requested",
                "meta": f"{r['name']} · {r.get('unitdivision') or r.get('business_unit') or ''} · est. KES {flt(r.get('estimated_cost')):,.0f}",
                "age": pretty_date(r["modified"]),
                "action": {"label": "Create Plan", "type": "method", "method": "create_plan", "name": r["name"]},
            })

    for p in plans:
        inbox.append({
            "kind": "plan",
            "title": f"{p['title'] or p['name']} plan ready · {cint(p.get('total_workers_planned'))} workers picked",
            "meta": f"{p['name']}"
                    + (f" · from {p['task_work_request_ref']}" if p.get("task_work_request_ref") else "")
                    + (f" · starts {p['custom_expected_start_date']}" if p.get("custom_expected_start_date") else ""),
            "age": pretty_date(p["modified"]),
            "action": {"label": "Create Assignment", "type": "method", "method": "create_assignment", "name": p["name"]},
        })

    for c in change_requests:
        who = f"{c.get('old_employee') or ''} → {c.get('new_employee') or ''}" if c.get("old_employee") else (c.get("new_employee") or "")
        inbox.append({
            "kind": "change",
            "title": f"{c['change_type']} on {c.get('task_work_assignment') or '—'}",
            "meta": f"{c['name']} · {who}" + (f" · {(c.get('reason') or '')[:60]}" if c.get("reason") else ""),
            "age": pretty_date(c["modified"]),
            "action": {"label": "Review Change", "type": "route", "doctype": "TW Employee Change Request", "name": c["name"]},
        })

    return inbox


def _build_pipeline(requests, plans, assignments, disbursements):
    return {
        "requested": [
            {
                "id": r["name"],
                "name": r["title"] or r["name"],
                "meta": f"{r.get('farm_managers_name') or ''} · {cint(r.get('total_workers'))} workers",
                "amount": flt(r.get("estimated_cost")),
                "badge": "draft" if r["is_draft"] else pretty_date(r["modified"]),
                "tone": "ink" if r["is_draft"] else "warn",
                "doctype": "Task Work Request",
            }
            for r in requests
        ],
        "planned": [
            {
                "id": p["name"],
                "name": p["title"] or p["name"],
                "meta": f"{cint(p.get('total_workers_planned'))} workers picked"
                        + (f" · starts {p['custom_expected_start_date']}" if p.get("custom_expected_start_date") else ""),
                "amount": flt(p.get("approved_estimated_cost")),
                "badge": "understaffed" if cint(p.get("understaffed_tasks")) else "ready",
                "tone": "warn" if cint(p.get("understaffed_tasks")) else "clay",
                "doctype": "Task Work Plan",
            }
            for p in plans
        ],
        "running": [
            {
                "id": a["name"],
                "name": a["title"] or a["name"],
                "meta": f"day {a['day']} of {a['days_total']} · {a['crew']} workers" if a["days_total"] else f"{a['crew']} workers",
                "amount": flt(a.get("total_estimated_cost")),
                "badge": "over budget" if a["spend_pct"] > 100 else ("ends soon" if a.get("ends_soon") else "on track"),
                "tone": "hot" if a["spend_pct"] > 100 else ("warn" if a.get("ends_soon") else "ok"),
                "doctype": "Task Work Assignment",
            }
            for a in assignments
        ],
        "payment": [
            {
                "id": d["name"],
                "name": f"Week {d['week_number']} disbursement",
                "meta": f"{cint(d['total_workers'])} workers"
                        + (f" · paid {d['payment_date']}" if d["status"] == "Paid" and d.get("payment_date") else ""),
                "amount": flt(d.get("total_net")),
                "badge": d["status"].lower(),
                "tone": "ok" if d["status"] == "Paid" else "hot",
                "doctype": "TW Weekly Disbursement",
            }
            for d in reversed(disbursements["list"][-6:])
        ],
    }


def _build_cost_trend():
    rows = frappe.get_list(
        "TW Weekly Disbursement",
        filters={"docstatus": ("<", 2)},
        fields=["week_number", "year", "total_gross", "total_workers"],
        order_by="year desc, week_number desc",
        limit_page_length=8,
    )
    rows.reverse()
    return [
        {
            "label": f"Wk {r['week_number']}",
            "gross": flt(r["total_gross"]),
            "workers": cint(r["total_workers"]),
        }
        for r in rows
    ]


def _build_top_tasks(assignments):
    if not assignments:
        return []
    names = [a["name"] for a in assignments]
    rows = frappe.get_all(
        "Task Details",
        filters={"parent": ("in", names), "parenttype": "Task Work Assignment"},
        fields=["task_name", "estimated_cost", "workers"],
    )
    agg = {}
    for r in rows:
        key = r.task_name or "Untitled task"
        entry = agg.setdefault(key, {"task_name": key, "cost": 0, "workers": 0})
        entry["cost"] += flt(r.estimated_cost)
        entry["workers"] += cint(r.workers)
    top = sorted(agg.values(), key=lambda x: -x["cost"])[:5]
    return top


# ---------------------------------------------------------------------------
# Actions — thin wrappers around the existing chain methods so the hub
# advances documents with one click and the client can route to the result.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def create_plan(request_name):
    from kaitet_taskwork.kaitet_taskwork.doctype.task_work_request.task_work_request import (
        create_plan_from_request,
    )

    if not frappe.has_permission("Task Work Plan", "create"):
        frappe.throw(frappe._("Not permitted to create Task Work Plans"), frappe.PermissionError)
    result = create_plan_from_request(request_name)
    name = result.get("name") if isinstance(result, dict) else result
    return {"doctype": "Task Work Plan", "name": name}


@frappe.whitelist()
def create_assignment(plan_name):
    from kaitet_taskwork.kaitet_taskwork.doctype.task_work_plan.task_work_plan import (
        create_assignment_from_plan,
    )

    if not frappe.has_permission("Task Work Assignment", "create"):
        frappe.throw(frappe._("Not permitted to create Task Work Assignments"), frappe.PermissionError)
    name = create_assignment_from_plan(plan_name)
    return {"doctype": "Task Work Assignment", "name": name}

# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

"""
Company-based data isolation for kaitet_taskwork.

Every non-System Manager user is scoped to the company on their Employee
record.  Documents belonging to a different company are invisible to them
in list views, search, reports and API calls.

System Managers and users with no Employee record (pure admin accounts)
retain unrestricted access.
"""

import frappe


def get_user_company(user=None):
    """Return the company linked to *user*'s Employee record, or None."""
    user = user or frappe.session.user
    return frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "company")


def _is_system_manager(user=None):
    user = user or frappe.session.user
    if user in ("Administrator", "Guest"):
        return True
    return frappe.db.exists("Has Role", {"parent": user, "role": "System Manager"}) is not None


def _company_condition(table, field="company", user=None):
    """
    Return a SQL WHERE fragment that restricts *table*.*field* to the
    current user's company, or an empty string for System Managers.

    *table* should be the backtick-quoted SQL table alias, e.g.
    '`tabTask Work Request`'.
    """
    user = user or frappe.session.user
    if _is_system_manager(user):
        return ""

    company = get_user_company(user)
    if not company:
        # No Employee record found → allow (pure admin / guest handled above)
        return ""

    # Escape single quotes in company name
    safe = company.replace("'", "\\'")
    return f"{table}.`{field}` = '{safe}'"


# ---------------------------------------------------------------------------
# Per-doctype hooks registered in hooks.py
# ---------------------------------------------------------------------------

def conditions_task_work_request(user):
    return _company_condition("`tabTask Work Request`", user=user)


def conditions_task_work_plan(user):
    return _company_condition("`tabTask Work Plan`", user=user)


def conditions_task_work_assignment(user):
    return _company_condition("`tabTask Work Assignment`", user=user)


def conditions_tw_weekly_disbursement(user):
    return _company_condition("`tabTW Weekly Disbursement`", user=user)


# Note: Task Worker and Work Location have no company field, so no per-company
# filtering is applied to those master records.


@frappe.whitelist()
def get_current_user_company():
    """Return the company for the current user's Employee record.
    Used by client scripts to scope link-field queries."""
    return get_user_company()

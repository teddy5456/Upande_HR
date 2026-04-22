"""Install / refresh the TW Weekly Disbursement approval workflow.

HR Manager prepares the disbursement and submits it for approval.
CFO then approves or rejects. On approval, HR Manager marks it paid,
which creates the wages Journal Entry.
"""

import frappe


WORKFLOW_NAME = "TW Weekly Disbursement Approval"
DOCTYPE = "TW Weekly Disbursement"
HR_ROLE = "HR Manager"
FINANCE_ROLE = "CFO"


STATES = [
    # (state_name, doc_status, style, indicator/style for list)
    ("Draft",            "0", "Primary"),
    ("Pending Approval", "1", "Warning"),
    ("Approved",         "1", "Success"),
    ("Rejected",         "1", "Danger"),
    ("Paid",             "1", "Success"),
]

# State "owner": the role responsible while the doc is parked in that state.
# Transitions control who can *act* — this controls who can edit.
STATE_ROLE = {
    "Draft":            HR_ROLE,
    "Pending Approval": FINANCE_ROLE,
    "Approved":         HR_ROLE,
    "Rejected":         HR_ROLE,
    "Paid":             HR_ROLE,
}

TRANSITIONS = [
    # (from_state, action, next_state, allowed_role)
    ("Draft",            "Submit for Approval", "Pending Approval", HR_ROLE),
    ("Pending Approval", "Approve",             "Approved",         FINANCE_ROLE),
    ("Pending Approval", "Reject",              "Rejected",         FINANCE_ROLE),
    ("Approved",         "Mark as Paid",        "Paid",             HR_ROLE),
]


def _ensure_state(state_name, style):
    if not frappe.db.exists("Workflow State", state_name):
        frappe.get_doc({
            "doctype": "Workflow State",
            "workflow_state_name": state_name,
            "style": style,
        }).insert(ignore_permissions=True)


def _ensure_action(action_name):
    if not frappe.db.exists("Workflow Action Master", action_name):
        frappe.get_doc({
            "doctype": "Workflow Action Master",
            "workflow_action_name": action_name,
        }).insert(ignore_permissions=True)


def install_workflow():
    for state_name, _doc_status, style in STATES:
        _ensure_state(state_name, style)

    for _frm, action, _to, _role in TRANSITIONS:
        _ensure_action(action)

    wf = frappe.get_doc("Workflow", WORKFLOW_NAME) if frappe.db.exists("Workflow", WORKFLOW_NAME) else frappe.new_doc("Workflow")
    wf.workflow_name = WORKFLOW_NAME
    wf.document_type = DOCTYPE
    wf.is_active = 1
    wf.send_email_alert = 0
    wf.workflow_state_field = "status"

    wf.set("states", [])
    for state_name, doc_status, style in STATES:
        wf.append("states", {
            "state": state_name,
            "doc_status": doc_status,
            "allow_edit": STATE_ROLE.get(state_name, HR_ROLE),
            "update_field": "status",
            "update_value": state_name,
        })

    wf.set("transitions", [])
    for from_state, action, next_state, role in TRANSITIONS:
        wf.append("transitions", {
            "state":         from_state,
            "action":        action,
            "next_state":    next_state,
            "allowed":       role,
            "allow_self_approval": 1,
        })

    if wf.is_new():
        wf.insert(ignore_permissions=True)
    else:
        wf.save(ignore_permissions=True)

    frappe.db.commit()


def migrate_legacy_statuses():
    """Rename legacy 'Pending' status to 'Pending Approval' on existing records."""
    frappe.db.sql(
        """
        UPDATE `tabTW Weekly Disbursement`
           SET status = 'Pending Approval'
         WHERE status = 'Pending'
        """
    )
    frappe.db.commit()


def execute():
    migrate_legacy_statuses()
    install_workflow()

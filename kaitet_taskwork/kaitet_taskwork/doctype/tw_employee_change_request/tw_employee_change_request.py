# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from kaitet_taskwork.kaitet_taskwork.doctype.task_work_request.task_work_request import (
	_send_to_role, _send_to_user, _build_body
)


class TWEmployeeChangeRequest(Document):
	def before_insert(self):
		self.requested_by = frappe.session.user
		self.request_date = frappe.utils.today()
		emp_name = frappe.db.get_value("Task Worker", self.new_employee, "full_name") or self.new_employee
		self.title = f"{self.change_type} – {emp_name} on {self.task_work_assignment}"

	def on_update(self):
		self._send_notification()
		if self.status == "Approved":
			self._apply_change()

	def _send_notification(self):
		prev = self.get_doc_before_save()
		prev_status = (prev.get("status") if prev else None) or "Draft"
		if prev_status == self.status:
			return

		doc_link = frappe.utils.get_url_to_form(self.doctype, self.name)
		subject_base = f"Employee Change Request: {self.name}"

		def notify_hr(msg):
			_send_to_role("HR Manager", f"{subject_base} – {msg}", _build_body(self, msg, doc_link))

		def notify_requester(msg):
			_send_to_user(self.requested_by, f"{subject_base} – {msg}", _build_body(self, msg, doc_link))

		if self.status == "Pending HR Approval":
			notify_hr(
				f"New {self.change_type} request on {self.task_work_assignment} – pending your approval"
			)
		elif self.status == "Approved":
			notify_requester(f"Your {self.change_type} request has been approved and applied")
		elif self.status == "Rejected":
			notify_requester(
				f"Your {self.change_type} request has been rejected"
				+ (f": {self.approval_notes}" if self.approval_notes else "")
			)

	def _apply_change(self):
		"""Apply the approved employee change to the Task Work Assignment."""
		assignment = frappe.get_doc("Task Work Assignment", self.task_work_assignment)

		if self.change_type == "Add Employee":
			row = assignment.append("worker_assignments", {
				"employee_name": self.new_employee,
				"task": self.task or None,
			})
			frappe.db.insert({
				"doctype": "Worker Assignments",
				"parent": assignment.name,
				"parenttype": "Task Work Assignment",
				"parentfield": "worker_assignments",
				"employee_name": self.new_employee,
				"task": self.task or None,
			})

		elif self.change_type == "Replace Employee":
			if not self.old_employee:
				frappe.throw(_("Old Employee is required for Replace Employee change type."))

			# Find rows for old employee with no actual work
			rows = frappe.db.get_all(
				"Worker Assignments",
				filters={
					"parent": assignment.name,
					"employee_name": self.old_employee,
					"actual_quantity": 0,
					**({"task": self.task} if self.task else {})
				},
				fields=["name", "task", "uom", "rate", "daily_target",
				        "quantity_assigned", "days", "location", "assignment_date"]
			)
			if not rows:
				frappe.throw(_(
					"No replaceable rows found for {0} (rows with actual work cannot be replaced)."
				).format(self.old_employee))

			for r in rows:
				# Remove old row
				frappe.db.delete("Worker Assignments", r["name"])
				# Insert new row
				frappe.db.insert({
					"doctype": "Worker Assignments",
					"parent": assignment.name,
					"parenttype": "Task Work Assignment",
					"parentfield": "worker_assignments",
					"employee_name": self.new_employee,
					"task": r["task"],
					"uom": r["uom"],
					"rate": r["rate"],
					"daily_target": r["daily_target"],
					"quantity_assigned": r["quantity_assigned"],
					"days": r["days"],
					"location": r["location"],
					"assignment_date": r["assignment_date"],
				})

		frappe.db.commit()
		frappe.msgprint(
			_(f"Change applied to Task Work Assignment {self.task_work_assignment}."),
			indicator="green"
		)


@frappe.whitelist()
def submit_for_approval(name):
	doc = frappe.get_doc("TW Employee Change Request", name)
	if doc.status != "Draft":
		frappe.throw(_("Only Draft requests can be submitted for approval."))
	doc.db_set("status", "Pending HR Approval")
	doc.reload()
	doc._send_notification()
	return "ok"


@frappe.whitelist()
def approve_request(name, notes=None):
	doc = frappe.get_doc("TW Employee Change Request", name)
	if doc.status != "Pending HR Approval":
		frappe.throw(_("Only Pending HR Approval requests can be approved."))
	doc.db_set("approved_by", frappe.session.user)
	doc.db_set("approval_date", frappe.utils.today())
	if notes:
		doc.db_set("approval_notes", notes)
	doc.db_set("status", "Approved")
	doc.reload()
	doc._send_notification()
	doc._apply_change()
	return "ok"


@frappe.whitelist()
def reject_request(name, notes=None):
	doc = frappe.get_doc("TW Employee Change Request", name)
	if doc.status != "Pending HR Approval":
		frappe.throw(_("Only Pending HR Approval requests can be rejected."))
	doc.db_set("approved_by", frappe.session.user)
	doc.db_set("approval_date", frappe.utils.today())
	if notes:
		doc.db_set("approval_notes", notes)
	doc.db_set("status", "Rejected")
	doc.reload()
	doc._send_notification()
	return "ok"

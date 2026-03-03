# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import json
import math

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, add_days, getdate, today
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
			self._smart_assign_remaining(assignment)

		elif self.change_type == "Replace Employee":
			if not self.old_employee:
				frappe.throw(_("Old Employee is required for Replace Employee change type."))
			self._replace_worker(assignment)

		assignment.flags.ignore_permissions = True
		assignment.save()
		frappe.msgprint(
			_(f"Change applied to Task Work Assignment {self.task_work_assignment}."),
			indicator="green"
		)

	def _smart_assign_remaining(self, assignment):
		"""Assign remaining unallocated work across tasks to the new employee."""
		# Sum already-assigned quantity per task
		assigned_by_task = {}
		latest_date_by_task = {}
		for row in assignment.worker_assignments:
			if not row.task:
				continue
			assigned_by_task[row.task] = assigned_by_task.get(row.task, 0) + flt(row.quantity_assigned)
			if row.assignment_date:
				curr = latest_date_by_task.get(row.task)
				if not curr or getdate(row.assignment_date) > getdate(curr):
					latest_date_by_task[row.task] = row.assignment_date

		tasks_to_assign = [td for td in assignment.task_details
		                   if td.task and (not self.task or td.task == self.task)]

		rows_added = 0
		for td in tasks_to_assign:
			remaining = round(flt(td.total_work) - assigned_by_task.get(td.task, 0), 6)
			if remaining <= 0:
				continue

			daily_target = flt(td.daily_target) or 1
			rate         = flt(td.rate)

			# Start the day after the latest existing row for this task
			last_date = latest_date_by_task.get(td.task)
			start = add_days(last_date, 1) if last_date else (assignment.start_date or today())

			work_left = remaining
			day = 0
			while work_left > 0:
				qty = flt(min(daily_target, work_left), 2)
				assignment.append("worker_assignments", {
					"employee_name": self.new_employee,
					"task":              td.task,
					"uom":               td.uom,
					"daily_target":      daily_target,
					"rate":              rate,
					"quantity_assigned": qty,
					"total_assigned_cost": flt(rate * qty, 2),
					"days":              1,
					"assignment_date":   add_days(start, day),
				})
				work_left -= qty
				day += 1
				rows_added += 1

		if not rows_added:
			frappe.throw(_("No remaining work to assign — all tasks are already fully allocated."))

	def _replace_worker(self, assignment):
		"""Swap old_employee → new_employee on rows that have no actual work."""
		# Parse specific row selection from the dialog (if provided)
		selected_names = None
		if self.selected_rows:
			try:
				selected_names = set(json.loads(self.selected_rows))
			except Exception:
				pass

		filters = {
			"parent": assignment.name,
			"employee_name": self.old_employee,
			"actual_quantity": ["in", [0, None]],
		}
		if self.task:
			filters["task"] = self.task

		all_rows = frappe.db.get_all(
			"Worker Assignments", filters=filters,
			fields=["name", "task", "uom", "rate", "daily_target",
			        "quantity_assigned", "days", "location", "assignment_date"]
		)

		# Narrow to only the days the requester selected, if specified
		old_row_names = (
			[r for r in all_rows if r["name"] in selected_names]
			if selected_names else all_rows
		)

		if not old_row_names:
			frappe.throw(_(
				"No replaceable rows found for {0} — rows with recorded actual work cannot be replaced."
			).format(self.old_employee))

		# Build replacement rows
		for r in old_row_names:
			assignment.append("worker_assignments", {
				"employee_name":     self.new_employee,
				"task":              r["task"],
				"uom":               r["uom"],
				"rate":              r["rate"],
				"daily_target":      r["daily_target"],
				"quantity_assigned": r["quantity_assigned"],
				"total_assigned_cost": flt(flt(r["rate"]) * flt(r["quantity_assigned"]), 2),
				"days":              r["days"],
				"location":          r["location"],
				"assignment_date":   r["assignment_date"],
			})

		# Drop old rows
		old_names = {r["name"] for r in old_row_names}
		assignment.worker_assignments = [
			row for row in assignment.worker_assignments
			if row.name not in old_names
		]


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

# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from kaitet_taskwork.kaitet_taskwork.doctype.task_work_request.task_work_request import (
	_send_to_role, _send_to_user, _build_body
)


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


class TaskWorkPlan(Document):
	def validate(self):
		if self.task_work_request_ref:
			self.title = self.task_work_request_ref

		if self.managers_name:
			emp = frappe.db.get_value(
				"Employee", self.managers_name,
				["custom_business_unit", "company"],
				as_dict=True,
			)
			if emp:
				self.business_unit = emp.custom_business_unit or emp.company or self.business_unit

		if not self.cost_centre and self.managers_name:
			self.cost_centre = get_cost_centre_for_manager(self.managers_name)

	def on_submit(self):
		self.db_set("stage", "Planned")
		if self.task_work_request_ref:
			frappe.db.set_value(
				"Task Work Request", self.task_work_request_ref, "stage", "Planned"
			)

	def on_update(self):
		self._send_workflow_notification()

	def _send_workflow_notification(self):
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
			_send_to_role(role, f"{subject_base} – {msg}", _build_body(self, msg, doc_link))

		def notify_owner(msg):
			_send_to_user(self.owner, f"{subject_base} – {msg}", _build_body(self, msg, doc_link))

		def notify_farm_manager(msg):
			if self.managers_name:
				user = frappe.db.get_value("Employee", self.managers_name, "user_id")
				if user:
					_send_to_user(user, f"{subject_base} – {msg}", _build_body(self, msg, doc_link))

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

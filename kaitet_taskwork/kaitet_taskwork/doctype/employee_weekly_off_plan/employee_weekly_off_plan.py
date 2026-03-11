# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today


class EmployeeWeeklyOffPlan(Document):
	def on_submit(self):
		self.update_employee_holiday_lists()

	def on_cancel(self):
		self.revert_employee_holiday_lists()

	def update_employee_holiday_lists(self):
		"""Update each employee's holiday list from the Weekly Offs child table."""
		updated = 0
		for row in (self.weekly_offs or []):
			if not row.employee_name or not row.holiday_list:
				continue
			# Save previous holiday list before overwriting
			if not row.previous_holiday_list:
				prev = frappe.db.get_value("Employee", row.employee_name, "holiday_list")
				if prev:
					frappe.db.set_value("Weekly Offs", row.name, "previous_holiday_list", prev)
			# Apply new holiday list
			frappe.db.set_value("Employee", row.employee_name, "holiday_list", row.holiday_list)
			updated += 1

		if updated:
			frappe.msgprint(f"Updated holiday lists for {updated} employee(s).")

	def revert_employee_holiday_lists(self):
		"""Restore each employee's previous holiday list."""
		reverted = 0
		for row in (self.weekly_offs or []):
			if not row.employee_name:
				continue
			prev = frappe.db.get_value("Weekly Offs", row.name, "previous_holiday_list")
			if prev:
				frappe.db.set_value("Employee", row.employee_name, "holiday_list", prev)
				reverted += 1

		if reverted:
			frappe.db.set_value("Employee Weekly Off Plan", self.name, "reverted", 1)
			frappe.msgprint(f"Reverted holiday lists for {reverted} employee(s).")


def revert_expired_weekly_off_plans():
	"""Scheduled daily: revert holiday lists for plans whose end_date has passed."""
	expired_plans = frappe.get_all(
		"Employee Weekly Off Plan",
		filters={
			"docstatus": 1,
			"reverted": 0,
			"end_date": ["<", today()],
		},
		fields=["name"],
	)

	for plan_ref in expired_plans:
		doc = frappe.get_doc("Employee Weekly Off Plan", plan_ref.name)
		reverted = 0
		for row in (doc.weekly_offs or []):
			if not row.employee_name:
				continue
			prev = frappe.db.get_value("Weekly Offs", row.name, "previous_holiday_list")
			if prev:
				frappe.db.set_value("Employee", row.employee_name, "holiday_list", prev)
				reverted += 1

		if reverted:
			frappe.db.set_value("Employee Weekly Off Plan", doc.name, "reverted", 1)
			frappe.logger().info(
				f"[Weekly Off Plan] Reverted {reverted} employee(s) for plan {doc.name} (end_date passed)."
			)

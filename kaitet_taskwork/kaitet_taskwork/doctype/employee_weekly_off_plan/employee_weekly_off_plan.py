# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class EmployeeWeeklyOffPlan(Document):
	def on_submit(self):
		self.update_employee_holiday_lists()

	def update_employee_holiday_lists(self):
		"""Update each employee's holiday list from the Weekly Offs child table."""
		updated = 0
		for row in (self.weekly_offs or []):
			if not row.employee_name or not row.holiday_list:
				continue
			# Save previous holiday list
			if not row.previous_holiday_list:
				prev = frappe.db.get_value("Employee", row.employee_name, "holiday_list")
				if prev:
					frappe.db.set_value("Weekly Offs", row.name, "previous_holiday_list", prev)
			# Apply new holiday list
			frappe.db.set_value("Employee", row.employee_name, "holiday_list", row.holiday_list)
			updated += 1

		if updated:
			frappe.msgprint(f"Updated holiday lists for {updated} employee(s).")

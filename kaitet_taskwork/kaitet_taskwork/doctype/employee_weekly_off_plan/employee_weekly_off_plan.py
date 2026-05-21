# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import getdate, today


class EmployeeWeeklyOffPlan(Document):
	def on_submit(self):
		# Apply now only if the start date has arrived. Otherwise the daily
		# `apply_pending_weekly_off_plans` job will apply it on/after start_date.
		if getdate(self.start_date) <= getdate(today()):
			if not self.end_date or getdate(self.end_date) >= getdate(today()):
				self.update_employee_holiday_lists()

	def on_cancel(self):
		# Nothing was applied yet — nothing to revert.
		if not self.applied or self.reverted:
			return
		self.revert_employee_holiday_lists()

	@frappe.whitelist()
	def update_employee_holiday_lists(self):
		"""Update each employee's holiday list from the Weekly Offs child table."""
		updated = 0
		for row in (self.weekly_offs or []):
			if not row.employee_name or not row.holiday_list:
				continue
			if not row.previous_holiday_list:
				prev = frappe.db.get_value("Employee", row.employee_name, "holiday_list")
				if prev:
					frappe.db.set_value("Weekly Offs", row.name, "previous_holiday_list", prev)
			frappe.db.set_value("Employee", row.employee_name, "holiday_list", row.holiday_list)
			updated += 1

		if updated:
			frappe.db.set_value("Employee Weekly Off Plan", self.name, "applied", 1)
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


def apply_pending_weekly_off_plans():
	"""Scheduled daily: apply submitted plans whose start_date has arrived."""
	pending = frappe.get_all(
		"Employee Weekly Off Plan",
		filters={
			"docstatus": 1,
			"applied": 0,
			"reverted": 0,
			"start_date": ["<=", today()],
		},
		fields=["name", "end_date"],
	)

	for plan_ref in pending:
		# Skip plans that have already expired before being applied.
		if plan_ref.end_date and getdate(plan_ref.end_date) < getdate(today()):
			continue
		doc = frappe.get_doc("Employee Weekly Off Plan", plan_ref.name)
		doc.update_employee_holiday_lists()
		frappe.logger().info(
			f"[Weekly Off Plan] Applied plan {doc.name} on start_date {doc.start_date}."
		)


def revert_expired_weekly_off_plans():
	"""Scheduled daily: revert holiday lists for plans whose end_date has passed."""
	expired_plans = frappe.get_all(
		"Employee Weekly Off Plan",
		filters={
			"docstatus": 1,
			"applied": 1,
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

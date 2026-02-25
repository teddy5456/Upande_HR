# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class TaskWorkAssignment(Document):
	def validate(self):
		if self.task_work_request:
			self.title = self.task_work_request

		# Inherit business_unit and cost_centre from the linked plan if not set
		if self.task_work_plan and (not self.business_unit or not self.cost_centre):
			plan = frappe.db.get_value(
				"Task Work Plan", self.task_work_plan,
				["business_unit", "cost_centre"], as_dict=True,
			)
			if plan:
				if not self.business_unit and plan.business_unit:
					self.business_unit = plan.business_unit
				if not self.cost_centre and plan.cost_centre:
					self.cost_centre = plan.cost_centre

		self.update_stage()
		self.calculate_worker_achievements()
		self.validate_achievement_totals()

	def update_stage(self):
		if self.completion_date:
			self.stage = "Completed"
		elif self.start_date:
			self.stage = "In Progress"
		else:
			self.stage = "Pending"

	def calculate_worker_achievements(self):
		"""Auto-calculate achievement % and actual_cost for each worker row."""
		for row in self.worker_assignments:
			qty_assigned = flt(row.quantity_assigned)
			actual_qty   = flt(row.actual_quantity)
			rate         = flt(row.rate)

			if qty_assigned > 0:
				row.achievement = round(actual_qty / qty_assigned * 100, 1)

			row.actual_cost = round(actual_qty * rate, 2)

	def validate_achievement_totals(self):
		"""
		Individual workers may exceed their own allocation (>100% achievement is fine).
		However, the SUM of actual_quantity across all workers for a task must not
		exceed that task's total_work — if someone did extra, others must have done less.
		"""
		if not self.worker_assignments or not self.task_details:
			return

		total_work_map = {row.task: flt(row.total_work) for row in self.task_details}

		actual_by_task = {}
		for row in self.worker_assignments:
			if row.task and row.actual_quantity:
				actual_by_task[row.task] = (
					actual_by_task.get(row.task, 0) + flt(row.actual_quantity)
				)

		errors = []
		for task_id, actual in actual_by_task.items():
			total = total_work_map.get(task_id, 0)
			if total > 0 and actual > total:
				task_name = frappe.db.get_value("Task", task_id, "subject") or task_id
				errors.append(
					f"Task <b>{task_name}</b>: total actual quantity "
					f"({actual:.2f}) exceeds total work ({total:.2f}). "
					f"Reduce work from over-performing workers so the sum stays within the allocation."
				)

		if errors:
			frappe.throw("<br><br>".join(errors), title="Total Work Exceeded")

	def on_submit(self):
		if self.task_work_request:
			frappe.db.set_value(
				"Task Work Request", self.task_work_request, "stage", "Assigned"
			)
		if self.task_work_plan:
			frappe.db.set_value(
				"Task Work Plan", self.task_work_plan, "stage", "Assigned"
			)

# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import unittest

import frappe
from frappe.exceptions import ValidationError


def _make_bor(title, farm, posting_date, employees, hours=2.0):
	"""Helper: build (but do not insert) a BulkOvertimeRequisition doc."""
	doc = frappe.new_doc("Bulk Overtime Requisition")
	doc.title = title
	doc.unitdivision = farm
	doc.posting_date = f"{posting_date} 08:00:00"
	doc.hours = hours
	doc.reason = "Test"
	doc.managersupervisor_name = _get_any_non_supervisor_employee()
	for emp in employees:
		doc.append("entries", {"employee_name": emp})
	return doc


def _get_any_non_supervisor_employee():
	"""Return the name (ID) of any active employee whose designation is not supervisory."""
	emp = frappe.db.sql(
		"""
		SELECT name FROM `tabEmployee`
		WHERE status = 'Active'
		  AND (designation IS NULL OR designation NOT LIKE '%Supervisor%')
		LIMIT 1
		""",
		as_dict=True,
	)
	if not emp:
		frappe.throw("No suitable non-supervisor employee found for test setup.")
	return emp[0].name


def _get_supervisor_employee():
	"""Return the name (ID) of an employee whose designation contains 'Supervisor'."""
	emp = frappe.db.sql(
		"""
		SELECT name FROM `tabEmployee`
		WHERE status = 'Active'
		  AND designation LIKE '%Supervisor%'
		LIMIT 1
		""",
		as_dict=True,
	)
	return emp[0].name if emp else None


def _get_two_non_supervisor_employees():
	"""Return IDs of two distinct non-supervisor active employees."""
	emps = frappe.db.sql(
		"""
		SELECT name FROM `tabEmployee`
		WHERE status = 'Active'
		  AND (designation IS NULL OR designation NOT LIKE '%Supervisor%')
		LIMIT 2
		""",
		as_dict=True,
	)
	if len(emps) < 2:
		frappe.throw("Need at least 2 non-supervisor employees for cross-farm test.")
	return emps[0].name, emps[1].name


class TestBulkOvertimeRequisitionValidations(unittest.TestCase):
	def tearDown(self):
		frappe.db.rollback()

	# ------------------------------------------------------------------
	# 1. Duplicate employee in the same child table
	# ------------------------------------------------------------------
	def test_duplicate_employee_raises(self):
		emp = _get_any_non_supervisor_employee()
		doc = _make_bor("TEST-BOR-DUP", "Farm A", "2099-01-01", [emp, emp])
		with self.assertRaises(ValidationError) as ctx:
			doc.validate()
		self.assertIn("more than once", str(ctx.exception))

	def test_unique_employees_pass(self):
		emp1, emp2 = _get_two_non_supervisor_employees()
		doc = _make_bor("TEST-BOR-UNIQUE", "Farm A", "2099-01-02", [emp1, emp2])
		try:
			doc.validate()
		except ValidationError as e:
			self.fail(f"Unexpected ValidationError for unique employees: {e}")

	# ------------------------------------------------------------------
	# 2. Supervisor designation restriction
	# ------------------------------------------------------------------
	def test_supervisor_employee_raises(self):
		sup = _get_supervisor_employee()
		if not sup:
			self.skipTest("No supervisor employee found in the database.")
		doc = _make_bor("TEST-BOR-SUP", "Farm A", "2099-01-03", [sup])
		with self.assertRaises(ValidationError) as ctx:
			doc.validate()
		self.assertIn("Supervisor", str(ctx.exception))

	# ------------------------------------------------------------------
	# 3. Cross-farm conflict on the same day
	# ------------------------------------------------------------------
	def test_cross_farm_conflict_raises(self):
		emp1, emp2 = _get_two_non_supervisor_employees()
		# Insert a BOR; the actual unitdivision comes from the supervisor's fetch field
		doc_a = _make_bor("TEST-BOR-FARM-A", "placeholder", "2099-02-01", [emp1])
		doc_a.insert(ignore_permissions=True)
		actual_farm = frappe.db.get_value("Bulk Overtime Requisition", doc_a.name, "unitdivision") or "Farm A"

		# Build a second BOR with a different farm name on the same day for the same employee
		doc_b = _make_bor("TEST-BOR-FARM-B", "placeholder", "2099-02-01", [emp1])
		doc_b.unitdivision = "COMPLETELY_DIFFERENT_FARM_XYZ_9999"  # guaranteed different
		with self.assertRaises(ValidationError) as ctx:
			doc_b.validate()
		self.assertIn(actual_farm, str(ctx.exception))

	def test_same_farm_same_day_does_not_raise(self):
		"""Same employee on same day for the same farm should not trigger the cross-farm rule."""
		emp1, emp2 = _get_two_non_supervisor_employees()
		doc_a = _make_bor("TEST-BOR-SAME-FARM-A", "placeholder", "2099-03-01", [emp1])
		doc_a.insert(ignore_permissions=True)
		actual_farm = frappe.db.get_value("Bulk Overtime Requisition", doc_a.name, "unitdivision") or ""

		# Second doc, same farm as doc_a, same employee — cross-farm check must NOT trigger
		doc_b = _make_bor("TEST-BOR-SAME-FARM-B", actual_farm, "2099-03-01", [emp1])
		doc_b.unitdivision = actual_farm  # ensure it matches what is stored for doc_a
		try:
			doc_b.validate_cross_farm_entries()
		except ValidationError as e:
			self.fail(f"Cross-farm check incorrectly blocked same-farm entry: {e}")

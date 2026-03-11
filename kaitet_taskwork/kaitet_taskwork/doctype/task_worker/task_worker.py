import random

import frappe
from frappe.model.document import Document


class TaskWorker(Document):
    def autoname(self):
        if self.payroll_number:
            # Importing an existing worker — use the supplied number
            self.payroll_number = str(self.payroll_number).strip()
            if not self.payroll_number.isdigit() or len(self.payroll_number) != 5:
                frappe.throw(frappe._("Payroll Number must be exactly 5 digits (e.g. 45677)."))
            if frappe.db.exists("Task Worker", self.payroll_number):
                frappe.throw(frappe._("Payroll Number {0} is already in use by a Task Worker.").format(self.payroll_number))
            self._check_employee_payroll_duplicate(self.payroll_number)
        else:
            self.payroll_number = self._generate_payroll_number()
        self.name = self.payroll_number

    def _generate_payroll_number(self):
        existing = set(frappe.db.sql_list("SELECT name FROM `tabTask Worker`"))
        for _ in range(10000):
            candidate = str(random.randint(10000, 99999))
            if candidate not in existing:
                return candidate
        frappe.throw(frappe._("Could not generate a unique payroll number. Please contact the system administrator."))

    def validate(self):
        self.set_full_name()
        self.validate_payment_method()
        self._check_employee_payroll_duplicate(self.payroll_number, exclude_self=True)

    def set_full_name(self):
        names = [self.first_name or "", self.second_name or "", self.last_name or ""]
        self.full_name = " ".join(n for n in names if n).strip()

    def _check_employee_payroll_duplicate(self, payroll_number, exclude_self=False):
        """Raise an error if payroll_number already exists in the Employee table."""
        if not payroll_number:
            return
        emp = frappe.db.get_value("Employee", {"employee_number": str(payroll_number)}, "name")
        if emp:
            frappe.throw(
                frappe._("Payroll Number {0} is already assigned to Employee {1}. "
                         "Each payroll number must be unique across Task Workers and Employees.").format(
                    payroll_number, emp
                )
            )

    def validate_payment_method(self):
        if self.payment_method == "Bank Transfer":
            if not self.bank_name:
                frappe.throw(
                    frappe._("Please enter Bank Name for Bank Transfer payment method")
                )
            if not self.account_number:
                frappe.throw(
                    frappe._("Please enter Account Number for Bank Transfer payment method")
                )
        elif self.payment_method == "M-Pesa":
            if not self.mpesa_phone:
                frappe.throw(frappe._("Please enter M-Pesa Phone Number"))


@frappe.whitelist()
def get_available_task_workers(plan_workers=None):
    """Return Task Workers who are Active and have no current submitted assignment.

    Args:
        plan_workers: JSON list of Task Worker names from the linked plan.
                      When supplied, only those workers are considered.
    """
    import json

    filters = {"status": "Active", "current_assignment": ["in", ["", None]]}

    if plan_workers:
        if isinstance(plan_workers, str):
            plan_workers = json.loads(plan_workers)
        if plan_workers:
            filters["name"] = ["in", plan_workers]

    return frappe.get_all(
        "Task Worker",
        filters=filters,
        fields=["name", "full_name", "payment_method", "status"],
        order_by="full_name asc",
    )

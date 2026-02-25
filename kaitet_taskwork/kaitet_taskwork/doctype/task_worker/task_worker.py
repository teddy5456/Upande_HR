import frappe
from frappe.model.document import Document


class TaskWorker(Document):
    def validate(self):
        self.set_full_name()
        self.validate_payment_method()

    def set_full_name(self):
        names = [self.first_name or "", self.second_name or "", self.last_name or ""]
        self.full_name = " ".join(n for n in names if n).strip()

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

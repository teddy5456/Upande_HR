import frappe
from frappe.model.document import Document
from frappe.utils import getdate, nowdate, date_diff, flt


@frappe.whitelist()
def get_default_accounts(company):
	"""Return default wages expense and payment bank accounts for the given company."""
	wages = frappe.db.get_value(
		"Account",
		{"company": company, "account_name": "Daily Rate Wages", "is_group": 0},
		"name",
	)
	payment = frappe.db.get_value(
		"Account",
		{"company": company, "account_number": "1310262053257", "is_group": 0},
		"name",
	)
	return {"wages_account": wages, "payment_account": payment}


def _get_worker_details(wid):
	"""
	Return name and payment details for a worker ID.
	Supports both new Task Worker records and historical Employee records.
	"""
	if frappe.db.exists("Task Worker", wid):
		tw = frappe.get_doc("Task Worker", wid)
		if tw.payment_method == "Bank Transfer":
			bank_or_mpesa = f"{tw.bank_name or ''} – {tw.account_number or ''}".strip(" –")
		else:
			bank_or_mpesa = tw.mpesa_phone or ""
		return {
			"worker_name":    tw.full_name,
			"payment_method": tw.payment_method or "M-Pesa",
			"bank_or_mpesa":  bank_or_mpesa,
		}

	if frappe.db.exists("Employee", wid):
		emp = frappe.get_doc("Employee", wid)

		bank_acc = frappe.db.get_value(
			"Bank Account",
			{"party_type": "Employee", "party": wid},
			["bank", "bank_account_no"],
			as_dict=True,
		)

		if bank_acc and bank_acc.bank_account_no:
			payment_method = "Bank Transfer"
			bank_or_mpesa = f"{bank_acc.bank or ''} – {bank_acc.bank_account_no}".strip(" –")
		else:
			phone = (
				getattr(emp, "custom_mpesa_phone", None)
				or getattr(emp, "cell_number", None)
				or ""
			)
			payment_method = "M-Pesa" if phone else ""
			bank_or_mpesa  = phone

		return {
			"worker_name":    emp.employee_name,
			"payment_method": payment_method,
			"bank_or_mpesa":  bank_or_mpesa,
		}

	return {"worker_name": wid, "payment_method": "", "bank_or_mpesa": ""}


class TWWeeklyDisbursement(Document):

	def validate(self):
		self.calculate_totals()
		self.validate_not_already_paid()

	def validate_not_already_paid(self):
		if self.status == "Paid":
			return
		existing = frappe.db.exists("TW Weekly Disbursement", {
			"week_start_date": self.week_start_date,
			"week_end_date": self.week_end_date,
			"status": "Paid",
			"name": ["!=", self.name or ""]
		})
		if existing:
			frappe.throw(
				f"A paid disbursement already exists for this week: <b>{existing}</b>. "
				"You can view it as a historical record but cannot create a duplicate payment."
			)

	def calculate_totals(self):
		total_gross = 0
		total_deductions = 0
		total_net = 0
		for entry in self.disbursement_entries:
			entry.net_amount = flt(entry.gross_amount) - flt(entry.deductions)
			total_gross += flt(entry.gross_amount)
			total_deductions += flt(entry.deductions)
			total_net += entry.net_amount
		self.total_gross = total_gross
		self.total_deductions = total_deductions
		self.total_net = total_net
		self.total_workers = len(self.disbursement_entries)

	@frappe.whitelist()
	def get_worker_payments(self):
		"""
		Find all Task Work Assignments whose period overlaps with the selected week,
		then aggregate days and pay per worker from the Worker Assignments child table.
		"""
		if not self.week_start_date or not self.week_end_date:
			frappe.throw("Please set Year and Week Number first.")

		week_start = getdate(self.week_start_date)
		week_end = getdate(self.week_end_date)

		# Assignments overlapping the week (not cancelled)
		assignments = frappe.db.sql("""
			SELECT name, start_date, completion_date,
			       expected_start_date, expected_end_date,
			       task_work_request, task_work_plan, unitdivision, cost_centre
			FROM `tabTask Work Assignment`
			WHERE docstatus != 2
			  AND (
			      (start_date IS NOT NULL
			         AND start_date <= %(end)s
			         AND COALESCE(completion_date, %(end)s) >= %(start)s)
			   OR (start_date IS NULL
			         AND expected_start_date <= %(end)s
			         AND expected_end_date >= %(start)s)
			  )
		""", {"start": week_start, "end": week_end}, as_dict=True)

		if not assignments:
			frappe.msgprint(
				"No Task Work Assignments found overlapping with the selected week.",
				title="No Data", indicator="orange"
			)
			return

		worker_totals    = {}   # keyed by worker ID
		assignment_index = {}   # one row per assignment

		for asgn in assignments:
			asgn_start = getdate(asgn.start_date or asgn.expected_start_date)
			asgn_end   = getdate(asgn.completion_date or asgn.expected_end_date)

			overlap_start = max(asgn_start, week_start)
			overlap_end   = min(asgn_end, week_end)
			days_in_week  = date_diff(overlap_end, overlap_start) + 1
			if days_in_week < 1:
				continue

			workers = frappe.db.get_all(
				"Worker Assignments",
				filters={"parent": asgn.name, "parenttype": "Task Work Assignment"},
				fields=["employee_name", "rate", "actual_quantity", "actual_cost", "location"]
			)

			asgn_amount = 0

			for w in workers:
				if not w.employee_name:
					continue

				wid = w.employee_name
				actual_qty  = flt(w.actual_quantity)
				actual_cost = flt(w.actual_cost) if w.actual_cost else actual_qty * flt(w.rate)

				if wid not in worker_totals:
					details = _get_worker_details(wid)
					worker_totals[wid] = {
						"task_worker":    wid,
						"worker_name":    details["worker_name"],
						"payment_method": details["payment_method"],
						"bank_or_mpesa":  details["bank_or_mpesa"],
						"gross_amount":   0,
						"deductions":     0,
						"net_amount":     0,
						"paid":           0,
					}

				worker_totals[wid]["gross_amount"]  += actual_cost
				asgn_amount += actual_cost

			# One summary row per assignment (not per worker)
			if asgn.name not in assignment_index:
				assignment_index[asgn.name] = {
					"daily_form_ref": asgn.name,
					"task_name":      asgn.task_work_request or asgn.name,
					"work_date":      str(overlap_start),
					"work_location":  asgn.unitdivision or "",
					"cost_centre":    asgn.cost_centre or "",
					"amount":         0,
				}
			assignment_index[asgn.name]["amount"] += asgn_amount

		if not worker_totals:
			frappe.msgprint("No active workers found in the matching assignments.")
			return

		for data in worker_totals.values():
			# gross_amount already accumulated from actual_cost; compute net
			data["net_amount"] = data["gross_amount"] - data["deductions"]

		self.disbursement_entries = []
		self.task_breakdown = []

		for data in worker_totals.values():
			self.append("disbursement_entries", data)

		for row in assignment_index.values():
			self.append("task_breakdown", row)

		self.calculate_totals()

		frappe.msgprint(
			f"Loaded <b>{len(worker_totals)}</b> workers from "
			f"<b>{len(assignments)}</b> assignment(s).",
			title="Disbursement Loaded", indicator="green"
		)

	def on_submit(self):
		self.db_set("status", "Pending")

	@frappe.whitelist()
	def approve(self):
		if self.docstatus != 1:
			frappe.throw("Submit the disbursement before approving.")
		if self.status != "Pending":
			frappe.throw("Only Pending disbursements can be approved.")
		self.db_set("status", "Approved")

	@frappe.whitelist()
	def mark_as_paid(self):
		if self.status == "Paid":
			frappe.throw("This disbursement has already been paid.")
		if self.docstatus != 1:
			frappe.throw("Please submit the disbursement before marking as paid.")

		je = self._create_wages_journal_entry()
		je_name = je.name

		# Update parent fields directly — self.save() is blocked on submitted docs
		self.db_set("status",        "Paid",                 update_modified=False)
		self.db_set("paid_on",       nowdate(),               update_modified=False)
		self.db_set("paid_by",       frappe.session.user,     update_modified=False)
		self.db_set("journal_entry", je_name,                 update_modified=False)

		# Mark each disbursement row as paid
		for entry in self.disbursement_entries:
			frappe.db.set_value("TW Disbursement Entry", entry.name, "paid", 1)

		frappe.msgprint(
			f"Disbursement marked as <b>Paid</b>. "
			f"Journal Entry <b><a href='/app/journal-entry/{je_name}'>{je_name}</a></b> created.",
			title="Payment Recorded", indicator="green"
		)

	def _create_wages_journal_entry(self):
		"""
		DR: wages_account  — expense account (e.g. Daily Rate Wages)
		CR: payment_account — bank/cash account the wages are paid from
		"""
		wages_account   = getattr(self, "wages_account", None)
		payment_account = getattr(self, "payment_account", None)

		# Fall back to known defaults for Karen Roses
		company_for_lookup = self.company or "Karen Roses"
		if not wages_account:
			wages_account = frappe.db.get_value(
				"Account",
				{"company": company_for_lookup, "account_name": "Daily Rate Wages", "is_group": 0},
				"name",
			)
		if not payment_account:
			payment_account = frappe.db.get_value(
				"Account",
				{"company": company_for_lookup, "account_number": "1310262053257", "is_group": 0},
				"name",
			)

		if not wages_account:
			frappe.throw("Please set the <b>Wages Expense Account</b> before marking as paid.")
		if not payment_account:
			frappe.throw("Please set the <b>Payment Bank Account</b> before marking as paid.")

		# Validate accounts are ledger accounts (not group)
		for acc, label in [(wages_account, "Wages Expense Account"), (payment_account, "Payment Bank Account")]:
			if frappe.db.get_value("Account", acc, "is_group"):
				frappe.throw(f"<b>{label}</b> ({acc}) is a group account. Please select a ledger account.")

		# Derive company from wages_account
		company = frappe.db.get_value("Account", wages_account, "company") or self.company

		# Aggregate breakdown amounts per cost centre
		cc_amounts = {}
		for row in self.task_breakdown:
			cc = row.cost_centre or ""
			cc_amounts[cc] = cc_amounts.get(cc, 0) + flt(row.amount)

		je = frappe.new_doc("Journal Entry")
		je.company      = company
		je.posting_date = nowdate()
		je.cheque_no    = self.name
		je.cheque_date  = nowdate()
		je.user_remark  = (
			f"Task Work Wages – {self.name} "
			f"(Week {self.week_number}/{self.year})"
		)

		accounts = []

		if cc_amounts:
			for cc, amount in cc_amounts.items():
				if flt(amount) <= 0:
					continue
				accounts.append({
					"account":                   wages_account,
					"debit_in_account_currency": flt(amount),
					"cost_center":               cc or None,
				})
		else:
			accounts.append({
				"account":                   wages_account,
				"debit_in_account_currency": flt(self.total_net),
			})

		# Single credit to wages accruals
		accounts.append({
			"account":                    payment_account,
			"credit_in_account_currency": flt(self.total_net),
		})

		je.set("accounts", accounts)
		je.insert(ignore_permissions=True)
		je.submit()
		return je

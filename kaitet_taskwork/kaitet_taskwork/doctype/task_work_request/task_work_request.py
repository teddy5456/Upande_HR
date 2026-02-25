# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class TaskWorkRequest(Document):
	def on_submit(self):
		self.db_set("stage", "Requested")

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
		subject_base = f"Task Work Request: {self.name}"

		# Helper: email users with a given role
		def notify_role(role, msg):
			_send_to_role(role, f"{subject_base} – {msg}", _build_body(self, msg, doc_link))

		# Helper: email the document owner / requester
		def notify_owner(msg):
			_send_to_user(self.owner, f"{subject_base} – {msg}", _build_body(self, msg, doc_link))

		# Helper: email the farm manager on the doc
		def notify_farm_manager(msg):
			if self.farm_managers_name:
				user = frappe.db.get_value("Employee", self.farm_managers_name, "user_id")
				if user:
					_send_to_user(user, f"{subject_base} – {msg}", _build_body(self, msg, doc_link))

		transitions = {
			"Awaiting Approval from General Manager": lambda: notify_role(
				"General Manager",
				"Pending your approval"
			),
			"Approved by General Manager": lambda: (
				notify_owner("Approved by General Manager – Pending HR review"),
				notify_role("HR Manager", "Pending your review")
			),
			"Rejected by General Manager": lambda: notify_owner("Rejected by General Manager"),
			"Approved by HR": lambda: (
				notify_owner("Approved by HR – Request is fully approved"),
				notify_farm_manager("Your Task Work Request has been approved")
			),
			"Rejected by HR": lambda: notify_owner("Rejected by HR"),
		}

		action = transitions.get(curr_state)
		if action:
			action()


# ── Task Work Plan notifications ─────────────────────────────────────────────

def _send_to_role(role, subject, body):
	users = frappe.get_all(
		"Has Role",
		filters={"role": role},
		pluck="parent"
	)
	users = list(set(users))
	enabled = frappe.get_all("User", filters={"name": ["in", users], "enabled": 1}, pluck="name")
	for user in enabled:
		_send_to_user(user, subject, body)


def _send_to_user(user, subject, body):
	if not user:
		return
	email = frappe.db.get_value("User", user, "email") or user
	try:
		frappe.sendmail(recipients=[email], subject=subject, message=body, delayed=False)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Task Work notification failed: {subject}")


def _build_body(doc, message, link):
	return f"""
	<p>Hello,</p>
	<p><strong>{message}</strong></p>
	<ul>
		<li><strong>Document:</strong> {doc.name}</li>
		<li><strong>Title:</strong> {doc.get('title') or doc.name}</li>
		<li><strong>Status:</strong> {doc.workflow_state or ''}</li>
		<li><strong>Date:</strong> {doc.get('posting_date') or ''}</li>
	</ul>
	<p><a href="{link}">View Document</a></p>
	<p>Regards,<br>Upande HR System</p>
	"""

# Copyright (c) 2025, Upande and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class BulkOvertimeRequisition(Document):
	def validate(self):
		self.calculate_estimated_cost()

	def on_update(self):
		"""Handle workflow state changes and send notifications"""
		self.send_workflow_notifications()

	def calculate_estimated_cost(self):
		"""Calculate estimated overtime cost based on employees, hours, and hourly rate"""
		# Count total employees from entries table
		self.total_employees = len(self.entries) if self.entries else 0

		# Calculate estimated cost: employees × hours × hourly_rate
		hours = self.hours or 0
		hourly_rate = self.hourly_rate or 0

		self.estimated_cost = self.total_employees * hours * hourly_rate

	def send_workflow_notifications(self):
		"""Send notifications based on workflow state changes"""
		# Get the previous workflow state
		previous_doc = self.get_doc_before_save()
		if not previous_doc:
			return

		previous_state = previous_doc.get("workflow_state")
		current_state = self.workflow_state

		if previous_state == current_state:
			return

		# Notify HR when General Manager approves
		if current_state == "Approved by General Manager":
			self.notify_hr_on_gm_approval()

		# Notify requester when HR approves (final approval)
		if current_state == "Approved by HR":
			self.notify_requester_on_final_approval()

		# Notify requester if rejected
		if current_state in ["Rejected by General Manager", "Rejected by HR", "Rejected"]:
			self.notify_requester_on_rejection()

	def notify_hr_on_gm_approval(self):
		"""Send notification to HR when General Manager approves the overtime request"""
		hr_users = get_hr_users()

		for user in hr_users:
			frappe.publish_realtime(
				event="msgprint",
				message=_("Bulk Overtime Requisition {0} has been approved by General Manager and requires your review.").format(self.name),
				user=user
			)

			# Create a notification log
			create_notification(
				document=self,
				recipients=[user],
				subject=_("Overtime Requisition Approved by GM - Pending HR Review"),
				message=_("""
					<p>The following Bulk Overtime Requisition has been approved by the General Manager:</p>
					<ul>
						<li><strong>Title:</strong> {title}</li>
						<li><strong>Supervisor:</strong> {supervisor}</li>
						<li><strong>Unit/Division:</strong> {unit}</li>
						<li><strong>Date:</strong> {date}</li>
						<li><strong>Hours:</strong> {hours}</li>
						<li><strong>Total Employees:</strong> {total_employees}</li>
						<li><strong>Estimated Cost:</strong> {estimated_cost}</li>
						<li><strong>Reason:</strong> {reason}</li>
					</ul>
					<p>Please review and take necessary action.</p>
				""").format(
					title=self.title,
					supervisor=self.managersupervisor_name,
					unit=self.unitdivision or "N/A",
					date=self.posting_date,
					hours=self.hours or 0,
					total_employees=self.total_employees or 0,
					estimated_cost=frappe.format_value(self.estimated_cost, {"fieldtype": "Currency"}),
					reason=self.reason
				)
			)

	def notify_requester_on_final_approval(self):
		"""Send notification to requester when HR gives final approval"""
		if not self.owner:
			return

		create_notification(
			document=self,
			recipients=[self.owner],
			subject=_("Overtime Requisition Approved"),
			message=_("""
				<p>Your Bulk Overtime Requisition <strong>{title}</strong> has been approved by HR.</p>
				<p>You can now proceed to create the Overtime Claim.</p>
			""").format(title=self.title)
		)

	def notify_requester_on_rejection(self):
		"""Send notification to requester when request is rejected"""
		if not self.owner:
			return

		create_notification(
			document=self,
			recipients=[self.owner],
			subject=_("Overtime Requisition Rejected"),
			message=_("""
				<p>Your Bulk Overtime Requisition <strong>{title}</strong> has been rejected.</p>
				<p>Current Status: {status}</p>
				<p>Please contact your supervisor or HR for more information.</p>
			""").format(title=self.title, status=self.workflow_state)
		)


def get_hr_users():
	"""Get list of users with HR Manager or HR User role"""
	hr_users = frappe.get_all(
		"Has Role",
		filters={"role": ["in", ["HR Manager", "HR User"]]},
		pluck="parent"
	)
	# Remove duplicates and filter for enabled users
	hr_users = list(set(hr_users))
	enabled_users = frappe.get_all(
		"User",
		filters={"name": ["in", hr_users], "enabled": 1},
		pluck="name"
	)
	return enabled_users


def create_notification(document, recipients, subject, message):
	"""Create a notification for the given recipients"""
	for recipient in recipients:
		try:
			notification = frappe.new_doc("Notification Log")
			notification.subject = subject
			notification.email_content = message
			notification.for_user = recipient
			notification.document_type = document.doctype
			notification.document_name = document.name
			notification.type = "Alert"
			notification.insert(ignore_permissions=True)
		except Exception as e:
			frappe.log_error(f"Failed to create notification: {str(e)}", "Bulk Overtime Notification Error")


@frappe.whitelist()
def create_overtime_claim_from_bulk(bulk_requisition_name):
	"""Create an Overtime Claim from a Bulk Overtime Requisition"""
	try:
		bulk_req = frappe.get_doc("Bulk Overtime Requisition", bulk_requisition_name)

		# Check if claim already exists
		existing_claim = frappe.db.exists("Overtime Claim", {"bulk_request_ref": bulk_requisition_name})
		if existing_claim:
			return {
				"success": False,
				"message": _("An Overtime Claim already exists for this requisition: {0}").format(existing_claim)
			}

		# Create the Overtime Claim
		claim = frappe.new_doc("Overtime Claim")
		claim.bulk_request_ref = bulk_requisition_name
		claim.title = f"OT Claim - {bulk_req.title}"
		claim.managersupervisor_name = bulk_req.managersupervisor_name
		claim.unitdivision = bulk_req.unitdivision
		claim.business_unit = bulk_req.business_unit
		claim.posting_date = bulk_req.posting_date
		claim.reason = bulk_req.reason
		claim.custom_hours = bulk_req.hours
		claim.from_time = bulk_req.from_time
		claim.to_time = bulk_req.to_time
		claim.overtime_type = bulk_req.overtime_type

		# Populate the Overtime Claim Entry child table from bulk entries
		for entry in (bulk_req.entries or []):
			claim.append("custom_entries", {
				"employee_name": entry.employee_name,
				"payroll_no":    entry.payroll_no,
				"department":    entry.department,
				"greenhouse":    entry.greenhouse,
				"requested_hours": bulk_req.hours,
				"worked_hours":    bulk_req.hours,
			})

		claim.insert(ignore_permissions=True)

		return {
			"success": True,
			"message": _("Overtime Claim {0} created successfully with {1} employees.").format(
				claim.name, len(bulk_req.entries) if bulk_req.entries else 0
			),
			"claim_name": claim.name
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Create Overtime Claim Error")
		return {
			"success": False,
			"message": str(e)
		}

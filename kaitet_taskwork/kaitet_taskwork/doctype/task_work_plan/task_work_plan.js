// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

frappe.ui.form.on('Task Work Plan', {
	refresh: function(frm) {
		set_stage_indicator(frm);

		// Auto-populate posting date on new doc
		if (frm.is_new() && !frm.doc.posting_date) {
			frm.set_value('posting_date', frappe.datetime.now_datetime());
		}

		if (frm.doc.docstatus === 1 && !frm.is_new()) {
			frm.add_custom_button(__('Task Work Assignment'), function() {
				frappe.db.get_value('Task Work Assignment',
					{ task_work_plan: frm.doc.name }, 'name'
				).then(r => {
					if (r.message && r.message.name) {
						// Assignment already exists — open it
						frappe.set_route('Form', 'Task Work Assignment', r.message.name);
					} else {
						frappe.new_doc('Task Work Assignment', {
							task_work_plan:    frm.doc.name,
							task_work_request: frm.doc.task_work_request_ref,
							title:             frm.doc.title
						});
					}
				});
			}, __('Create'));
		}
	},

	validate: function(frm) {
		// Require expected start date
		if (!frm.doc.custom_expected_start_date) {
			frappe.msgprint(__("Expected Start Date is required."));
			frappe.validated = false;
			return;
		}
		validate_employee_count(frm);
	},

	managers_name: function(frm) {
		if (!frm.doc.managers_name) {
			frm.set_value('business_unit', '');
			frm.set_value('cost_centre', '');
			return;
		}

		// Set business_unit with fallback to company when custom_business_unit is empty
		frappe.db.get_value(
			'Employee', frm.doc.managers_name,
			['custom_business_unit', 'company']
		).then(r => {
			if (r.message) {
				frm.set_value(
					'business_unit',
					r.message.custom_business_unit || r.message.company || ''
				);
			}
		});

		// Auto-lookup the matching Cost Centre
		frappe.call({
			method: 'kaitet_taskwork.kaitet_taskwork.doctype.task_work_plan.task_work_plan.get_cost_centre_for_manager',
			args: { manager_id: frm.doc.managers_name },
			callback(r) {
				if (r.message) frm.set_value('cost_centre', r.message);
			}
		});
	},

	task_work_request_ref: function(frm) {
		if (frm.doc.task_work_request_ref) {
			frm.set_value('title', frm.doc.task_work_request_ref);
		}
	}
});

function set_stage_indicator(frm) {
	const colours = { 'Planned': 'blue', 'Assigned': 'orange', 'In Progress': 'yellow', 'Completed': 'green' };
	const stage = frm.doc.stage || 'Planned';
	frm.page.set_indicator(stage, colours[stage] || 'blue');
}

/* ── Task Plan child table ───────────────────────────────── */
frappe.ui.form.on('Task Plan', {
	// Filter employee_name to Active Task Workers only
	employee_name: function(frm, cdt, cdn) {
		frm.set_query('employee_name', 'entries', function() {
			return {
				doctype: 'Task Worker',
				filters: [['Task Worker', 'status', '=', 'Active']]
			};
		});
		validate_employee_count(frm);
	},
	entries_add:    function(frm) { setTimeout(() => validate_employee_count(frm), 100); },
	entries_remove: function(frm) { setTimeout(() => validate_employee_count(frm), 100); }
});

function validate_employee_count(frm) {
	const approved = parseInt(frm.doc.no_of_approved_workers) || 0;
	if (!approved) return true;

	const assigned = (frm.doc.entries || [])
		.filter(r => r.employee_name && r.employee_name.trim()).length;

	if (assigned > approved) {
		frappe.msgprint({
			title: __('Validation Error'),
			indicator: 'red',
			message: __(
				'You cannot assign {0} employees. Only {1} workers were approved. Please remove {2} employee(s).',
				[assigned, approved, assigned - approved]
			)
		});
		frappe.validated = false;
		return false;
	}
	return true;
}

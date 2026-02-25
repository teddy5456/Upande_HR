// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

frappe.ui.form.on('TW Employee Change Request', {
	refresh: function(frm) {
		frm.set_df_property('old_employee', 'hidden', frm.doc.change_type !== 'Replace Employee');

		if (frm.doc.status === 'Draft' && !frm.is_new()) {
			frm.add_custom_button(__('Submit for HR Approval'), function() {
				frappe.confirm(
					__('Send this change request to HR for approval?'),
					function() {
						frappe.call({
							method: 'kaitet_taskwork.kaitet_taskwork.doctype.tw_employee_change_request.tw_employee_change_request.submit_for_approval',
							args: { name: frm.doc.name },
							callback: () => frm.reload_doc()
						});
					}
				);
			}).addClass('btn-primary');
		}

		if (frm.doc.status === 'Pending HR Approval' && frappe.user.has_role('HR Manager')) {
			frm.add_custom_button(__('Approve'), function() {
				frappe.prompt(
					[{ fieldtype: 'Small Text', fieldname: 'notes', label: 'Approval Notes (optional)' }],
					function(vals) {
						frappe.call({
							method: 'kaitet_taskwork.kaitet_taskwork.doctype.tw_employee_change_request.tw_employee_change_request.approve_request',
							args: { name: frm.doc.name, notes: vals.notes },
							callback: () => frm.reload_doc()
						});
					},
					__('Approve Change Request'), __('Approve')
				);
			}, __('Actions')).css('color', 'green');

			frm.add_custom_button(__('Reject'), function() {
				frappe.prompt(
					[{ fieldtype: 'Small Text', fieldname: 'notes', label: 'Reason for Rejection', reqd: 1 }],
					function(vals) {
						frappe.call({
							method: 'kaitet_taskwork.kaitet_taskwork.doctype.tw_employee_change_request.tw_employee_change_request.reject_request',
							args: { name: frm.doc.name, notes: vals.notes },
							callback: () => frm.reload_doc()
						});
					},
					__('Reject Change Request'), __('Reject')
				);
			}, __('Actions')).css('color', 'red');
		}

		// Status indicator colour
		const colours = {
			'Draft': 'grey', 'Pending HR Approval': 'orange',
			'Approved': 'green', 'Rejected': 'red'
		};
		frm.page.set_indicator(frm.doc.status, colours[frm.doc.status] || 'grey');
	},

	change_type: function(frm) {
		frm.set_df_property('old_employee', 'hidden', frm.doc.change_type !== 'Replace Employee');
		frm.set_df_property('old_employee', 'reqd',   frm.doc.change_type === 'Replace Employee');
	}
});

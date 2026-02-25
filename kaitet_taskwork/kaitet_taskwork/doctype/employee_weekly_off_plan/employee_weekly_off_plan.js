// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

frappe.ui.form.on('Employee Weekly Off Plan', {

	refresh: function(frm) {
		// Auto-revert when to_date is today
		if (!frm.is_new() && frm.doc.to_dateoptional === frappe.datetime.get_today()) {
			auto_revert_employee_holiday_list(frm);
		}

		if (!frm.is_new() && frm.doc.docstatus === 1) {
			frm.add_custom_button(__('Update Employee Holiday List'), function() {
				force_update_employee_holiday_list(frm);
			}, __('Actions'));
			frm.page.set_inner_btn_group_as_primary(__('Actions'));
		}
	},

	on_submit: function(frm) {
		force_update_employee_holiday_list(frm);
	},

	manager: function(frm) {
		if (frm.doc.manager) {
			frappe.model.with_doc('Employee', frm.doc.manager, function() {
				let employee = frappe.model.get_doc('Employee', frm.doc.manager);
				frm.set_value('manager_name', employee.employee_name);
			});
		}
	},

	status: function(frm) {
		if (frm.doc.status === 'Approved' && !frm.doc.approved_by) {
			frm.set_value('approved_by', frappe.session.user);
			frm.set_value('approval_date', frappe.datetime.get_today());
		}
	},

	validate: function(frm) {
		if (!frm.doc.weekly_offs || frm.doc.weekly_offs.length === 0) {
			frappe.msgprint(__('Please add at least one employee to the Weekly Offs table'));
			frappe.validated = false;
		}
		if (frm.doc.to_dateoptional && frm.doc.to_dateoptional < frm.doc.from_date) {
			frappe.msgprint(__('To Date cannot be before From Date'));
			frappe.validated = false;
		}
	}
});

function force_update_employee_holiday_list(frm) {
	let rows = frm.doc.weekly_offs || [];
	if (!rows.length) { frappe.msgprint('No employees found.'); return; }

	frappe.confirm(
		'This will directly update the <b>Holiday List</b> for all employees.<br><br>Proceed?',
		function() {
			rows.forEach(row => {
				if (!row.employee_name || !row.holiday_list) return;

				frappe.call({
					method: 'frappe.client.get_value',
					args: { doctype: 'Employee', fieldname: 'holiday_list', filters: { name: row.employee_name } },
					callback: function(res) {
						let original = res.message.holiday_list || '';
						frappe.model.set_value(row.doctype, row.name, 'previous_holiday_list', original);

						frappe.call({
							method: 'frappe.client.set_value',
							args: { doctype: 'Employee', name: row.employee_name, fieldname: 'holiday_list', value: row.holiday_list },
							callback: () => {}
						});
					}
				});
			});
			frappe.msgprint('Employee Holiday Lists updated successfully.');
		}
	);
}

function auto_revert_employee_holiday_list(frm) {
	let rows = frm.doc.weekly_offs || [];
	if (!rows.length) return;

	frappe.confirm(
		`Today is <b>${frm.doc.to_dateoptional}</b>.<br>Do you want to <b>revert</b> all employees back to their previous Holiday Lists?`,
		function() {
			rows.forEach(row => {
				if (!row.employee_name || !row.previous_holiday_list) return;
				frappe.call({
					method: 'frappe.client.set_value',
					args: { doctype: 'Employee', name: row.employee_name, fieldname: 'holiday_list', value: row.previous_holiday_list },
					callback: () => {}
				});
			});
			frappe.msgprint('Employees reverted to previous holiday lists.');
		}
	);
}

/* ── Weekly Offs child table ─────────────────────────────── */
frappe.ui.form.on('Weekly Offs', {
	week_day: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		const mapping = {
			'Monday':    'Kaitet Group 2025 (w/ Mondays)',
			'Tuesday':   'Kaitet Group 2025 (w/ Tuesdays)',
			'Wednesday': 'Kaitet Group 2025 (w/ Wednesdays)',
			'Thursday':  'Kaitet Group 2025 (w/ Thursdays)',
			'Friday':    'Kaitet Group 2025 (w/ Fridays)',
			'Saturday':  'Kaitet Group 2025 (w/ Saturdays)',
			'Sunday':    'Kaitet Group 2025 (w/ Sundays)'
		};
		if (row.week_day) {
			frappe.model.set_value(cdt, cdn, 'holiday_list', mapping[row.week_day]);
		}
	},

	employee_name: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		let dup = frm.doc.weekly_offs.filter(d => d.employee_name === row.employee_name && d.name !== row.name);
		if (dup.length > 0) {
			frappe.msgprint('This employee is already in the list.');
			frappe.model.set_value(cdt, cdn, 'employee_name', '');
		}
	}
});

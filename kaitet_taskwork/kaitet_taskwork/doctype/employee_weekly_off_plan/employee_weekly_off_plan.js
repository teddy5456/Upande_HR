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
				frappe.confirm(
					'This will directly update the <b>Holiday List</b> for all employees.<br><br>Proceed?',
					function() {
						frm.call('update_employee_holiday_lists').then(() => frm.reload_doc());
					}
				);
			}, __('Actions'));
			frm.page.set_inner_btn_group_as_primary(__('Actions'));
		}

		// Always show rollover button for System Managers
		if (frappe.user.has_role('System Manager')) {
			frm.add_custom_button(__('Run Holiday List Rollover'), function() {
				frappe.confirm(
					__('This will create next year\'s holiday lists (from November) and reassign all employees from old-year lists to the current year. Proceed?'),
					function() {
						frappe.call({
							method: 'kaitet_taskwork.kaitet_taskwork.kaitet_taskwork.utils.run_holiday_rollover_now',
							freeze: true,
							freeze_message: __('Running holiday list rollover...'),
							callback: function(r) {
								if (r.message) {
									frappe.show_alert({ message: __(r.message.message), indicator: 'green' }, 5);
								}
							}
						});
					}
				);
			}, __('Actions'));
		}
	},

	manager: function(frm) {
		if (!frm.doc.manager) return;

		// If manager field has a full name (not an ID), look up the employee by name
		frappe.db.get_value('Employee', { employee_name: frm.doc.manager }, 'name').then(r => {
			if (r && r.message && r.message.name && r.message.name !== frm.doc.manager) {
				frm.set_value('manager', r.message.name);
				return;
			}
			// Normal path: fetch display name
			frappe.db.get_value('Employee', frm.doc.manager, 'employee_name').then(res => {
				if (res && res.message) {
					frm.set_value('manager_name', res.message.employee_name);
				}
			});
		});
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
		const current_year = new Date().getFullYear().toString();
		const stale = (frm.doc.weekly_offs || []).filter(r => r.holiday_list && !r.holiday_list.includes(current_year));
		if (stale.length) {
			frappe.msgprint({
				title: __('Stale Holiday Lists'),
				message: __(`${stale.length} row(s) have holiday lists from a previous year. Please re-select the week day for those rows to assign the ${current_year} list.`),
				indicator: 'orange'
			});
			frappe.validated = false;
		}
	}
});

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
		if (!row.week_day) return;
		const year = new Date().getFullYear();
		const mapping = {
			'Monday':    `Kaitet Group ${year} (w/ Mondays)`,
			'Tuesday':   `Kaitet Group ${year} (w/ Tuesdays)`,
			'Wednesday': `Kaitet Group ${year} (w/ Wednesdays)`,
			'Thursday':  `Kaitet Group ${year} (w/ Thursdays)`,
			'Friday':    `Kaitet Group ${year} (w/ Fridays)`,
			'Saturday':  `Kaitet Group ${year} (w/ Saturdays)`,
			'Sunday':    `Kaitet Group ${year} (w/ Sundays)`
		};
		// Verify list exists before setting
		frappe.db.exists('Holiday List', mapping[row.week_day]).then(exists => {
			if (exists) {
				frappe.model.set_value(cdt, cdn, 'holiday_list', mapping[row.week_day]);
			} else {
				frappe.model.set_value(cdt, cdn, 'holiday_list', '');
				frappe.msgprint({
					title: __('Holiday List Missing'),
					message: __(`"${mapping[row.week_day]}" does not exist. Please create the ${year} holiday lists first, then re-select the week day.`),
					indicator: 'red'
				});
			}
		});
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

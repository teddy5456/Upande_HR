// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

/* ================================================================
   TASK WORK ASSIGNMENT — main form JS
   ================================================================ */

frappe.ui.form.on('Task Work Assignment', {

	setup(frm) {
		frm._worker_list = [];   // Task Worker names from the linked Plan
	},

	/* ── On load / refresh ─────────────────────────────────── */
	refresh(frm) {
		set_stage_indicator(frm);
		render_connections(frm);

		// Always reload worker list from plan so queries stay fresh
		if (frm.doc.task_work_plan) {
			load_worker_list(frm).then(() => {
				set_child_queries(frm);
				show_action_buttons(frm);
			});
		} else {
			set_child_queries(frm);
			show_action_buttons(frm);
		}
	},

	/* ── Plan selected ─────────────────────────────────────── */
	task_work_plan(frm) {
		if (!frm.doc.task_work_plan) {
			frm._worker_list = [];
			frm.set_value('task_work_request', '');
			frm.clear_table('task_details');
			frm.clear_table('worker_assignments');
			set_child_queries(frm);
			return;
		}

		frappe.call({
			method: 'frappe.client.get',
			args: { doctype: 'Task Work Plan', name: frm.doc.task_work_plan },
			callback(r) {
				if (!r.message) return;
				const plan = r.message;

				// Build worker list from plan entries (task_worker field)
				frm._worker_list = [...new Set(
					(plan.entries || []).map(e => e.task_worker).filter(Boolean)
				)];

				// Auto-populate linked fields
				if (plan.task_work_request_ref && !frm.doc.task_work_request) {
					frm.set_value('task_work_request', plan.task_work_request_ref);
				}
				if (plan.managers_name && !frm.doc.farm_manager) {
					frm.set_value('farm_manager', plan.managers_name);
				}

				// Inherit business_unit and cost_centre from the plan
				if (plan.business_unit) frm.set_value('business_unit', plan.business_unit);
				if (plan.cost_centre)   frm.set_value('cost_centre',   plan.cost_centre);

				set_child_queries(frm);
				show_action_buttons(frm);
			}
		});
	},

	/* ── Request selected ──────────────────────────────────── */
	task_work_request(frm) {
		if (!frm.doc.task_work_request) return;

		// Use the request name directly as the title
		frm.set_value('title', frm.doc.task_work_request);

		// Populate task_details table
		populate_tasks_from_request(frm);
	},

	/* ── Validation ────────────────────────────────────────── */
	validate(frm) {
		validate_achievement_totals(frm);
		recalc_total_cost(frm);
	},

	before_submit(frm) {
		// Block submit if any worker row has zero actual quantity
		const zero_rows = (frm.doc.worker_assignments || [])
			.map((r, i) => ({ r, i }))
			.filter(({ r }) => !flt(r.actual_quantity));

		if (zero_rows.length) {
			frappe.msgprint({
				title: __('Submission Blocked'),
				message: zero_rows.map(({ i }) =>
					`Row ${i + 1}: Actual Quantity is 0. Fill in actual work before submitting.`
				).join('<br>'),
				indicator: 'orange'
			});
			frappe.validated = false;
		}
	}
});

/* ================================================================
   WORKER ASSIGNMENTS child table
   ================================================================ */
frappe.ui.form.on('Worker Assignments', {

	// Auto-populate row details when a task is chosen
	task(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.task) return;

		// Find the task in task_details for rate / UOM / target
		const td = (frm.doc.task_details || []).find(t => t.task === row.task);
		if (td) {
			frappe.model.set_value(cdt, cdn, 'uom',           td.uom);
			frappe.model.set_value(cdt, cdn, 'rate',          td.rate);
			frappe.model.set_value(cdt, cdn, 'daily_target',  td.daily_target);
		}
	},

	// Recalculate achievement + actual cost when quantities change
	actual_quantity:   (frm, cdt, cdn) => recalc_worker_row(frm, cdt, cdn),
	quantity_assigned: (frm, cdt, cdn) => recalc_worker_row(frm, cdt, cdn),
	rate:              (frm, cdt, cdn) => recalc_worker_row(frm, cdt, cdn),
});

/* ================================================================
   TASK DETAILS child table
   ================================================================ */
frappe.ui.form.on('Task Details', {
	task(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.task) return;
		frappe.db.get_value('Task', row.task, 'subject').then(r => {
			frappe.model.set_value(cdt, cdn, 'task_name',
				(r.message && r.message.subject) || row.task);
		});
	}
});

/* ================================================================
   HELPERS
   ================================================================ */

/* ── Stage colour indicator ─────────────────────────────────── */
function set_stage_indicator(frm) {
	const colours = { 'Pending': 'grey', 'In Progress': 'orange', 'Completed': 'green' };
	const stage = frm.doc.stage || 'Pending';
	frm.page.set_indicator(stage, colours[stage] || 'grey');
}

/* ── Connections: show linked Request + Plan ────────────────── */
function render_connections(frm) {
	if (frm.is_new()) return;
	const req  = frm.doc.task_work_request;
	const plan = frm.doc.task_work_plan;
	if (!req && !plan) return;

	const queries = [];
	if (req)  queries.push(frappe.db.get_value('Task Work Request', req,  ['title', 'stage']));
	if (plan) queries.push(frappe.db.get_value('Task Work Plan',    plan, ['title', 'stage']));

	Promise.all(queries).then(results => {
		let i = 0;
		const req_d  = req  ? results[i++].message : null;
		const plan_d = plan ? results[i++].message : null;

		const pill = stage => {
			const c = { Requested:'grey', Planned:'blue', Assigned:'green',
			            'In Progress':'orange', Completed:'green', Pending:'grey' };
			return `<span class="indicator-pill ${c[stage]||'grey'}"
			        style="font-size:10px;padding:1px 6px;">${stage||''}</span>`;
		};

		const row = (label, name, path, stage) =>
			`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
				<span class="text-muted" style="font-size:10px;font-weight:600;min-width:70px;">${label}</span>
				<a href="${path}">${frappe.utils.icon('file','xs')} ${name}</a>
				${pill(stage)}
			</div>`;

		const html = `<div style="padding:4px 0;">
			${req  ? row('REQUEST', req,  `/app/task-work-request/${encodeURIComponent(req)}`,  req_d  && req_d.stage)  : ''}
			${plan ? row('PLAN',    plan, `/app/task-work-plan/${encodeURIComponent(plan)}`,     plan_d && plan_d.stage) : ''}
		</div>`;

		frm.dashboard.add_section(html, __('Connections'));
	});
}

/* ── Load worker list from linked Plan ──────────────────────── */
function load_worker_list(frm) {
	return frappe.call({
		method: 'frappe.client.get',
		args: { doctype: 'Task Work Plan', name: frm.doc.task_work_plan }
	}).then(r => {
		if (r.message) {
			frm._worker_list = [...new Set(
				(r.message.entries || []).map(e => e.task_worker).filter(Boolean)
			)];
		}
	});
}

/* ── Query filters for child tables ─────────────────────────── */
function set_child_queries(frm) {
	// Worker Assignments → employee_name — only workers from the plan
	frm.set_query('employee_name', 'worker_assignments', () => {
		if (!frm._worker_list.length)
			return { filters: [['Task Worker', 'name', '=', '']] };
		return { filters: [['Task Worker', 'name', 'in', frm._worker_list]] };
	});

	// Worker Assignments → task — only tasks already in task_details
	frm.set_query('task', 'worker_assignments', () => {
		const tasks = (frm.doc.task_details || []).map(t => t.task).filter(Boolean);
		if (!tasks.length) return { filters: [['Task', 'name', '=', '']] };
		return { filters: [['Task', 'name', 'in', tasks]] };
	});
}

/* ── Populate task_details from linked Request ──────────────── */
function populate_tasks_from_request(frm) {
	frappe.call({
		method: 'frappe.client.get',
		args: { doctype: 'Task Work Request', name: frm.doc.task_work_request }
	}).then(r => {
		if (!r.message || !r.message.task_request_details) return;

		frm.clear_table('task_details');

		const items = r.message.task_request_details;
		Promise.all(items.map(item =>
			item.task
				? frappe.db.get_value('Task', item.task, 'subject')
				      .then(res => ({ item, task_name: (res.message && res.message.subject) || item.task }))
				: Promise.resolve({ item, task_name: 'Unnamed Task' })
		)).then(results => {
			results.forEach(({ item, task_name }) => {
				const row       = frm.add_child('task_details');
				row.task           = item.task;
				row.task_name      = task_name;
				row.uom            = item.uom;
				row.daily_target   = item.daily_target;
				row.rate           = item.rate;
				row.total_work     = item.total_work;
				row.workers        = item.workers;
				row.days           = item.days;
				row.estimated_cost = item.estimated_cost;
				row.status         = 'Pending';
			});
			frm.refresh_field('task_details');
			set_child_queries(frm);
			show_action_buttons(frm);
		});
	});
}

/* ── Recalculate achievement + actual_cost for a worker row ─── */
function recalc_worker_row(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	const qty_assigned = flt(row.quantity_assigned);
	const actual_qty   = flt(row.actual_quantity);
	const rate         = flt(row.rate);

	if (qty_assigned > 0)
		frappe.model.set_value(cdt, cdn, 'achievement',
			flt(actual_qty / qty_assigned * 100, 1));

	frappe.model.set_value(cdt, cdn, 'actual_cost', flt(actual_qty * rate, 2));
	recalc_total_cost(frm);
}

/* ── Recalculate total_estimated_cost header field ──────────── */
function recalc_total_cost(frm) {
	const total = (frm.doc.worker_assignments || [])
		.reduce((s, r) => s + flt(r.total_assigned_cost), 0);
	frm.set_value('total_estimated_cost', total);
}

/* ── Validate: total actual per task must not exceed total_work  */
function validate_achievement_totals(frm) {
	if (!frm.doc.worker_assignments || !frm.doc.task_details) return;

	// Sum actual_quantity per task across all worker rows
	const actual_by_task = {};
	frm.doc.worker_assignments.forEach(r => {
		if (r.task && r.actual_quantity)
			actual_by_task[r.task] = (actual_by_task[r.task] || 0) + flt(r.actual_quantity);
	});

	const errors = [];
	frm.doc.task_details.forEach(t => {
		const actual = actual_by_task[t.task] || 0;
		const total  = flt(t.total_work);
		if (total > 0 && actual > total)
			errors.push(
				`<b>${t.task_name || t.task}</b>: ` +
				`total actual (${actual.toFixed(2)}) exceeds total work (${total.toFixed(2)}). ` +
				`Reduce work from over-performers so the sum stays within the allocation.`
			);
	});

	if (errors.length) {
		frappe.msgprint({
			title: __('Total Work Exceeded'),
			message: errors.join('<br><br>'),
			indicator: 'red'
		});
		frappe.validated = false;
	}
}

/* ── Show action buttons ─────────────────────────────────────── */
function show_action_buttons(frm) {
	if (frm.doc.docstatus !== 0) return;

	// Add Employee — creates a Change Request requiring HR approval
	frm.add_custom_button(__('Add Employee'), () => {
		request_employee_change(frm, 'Add Employee');
	});

	// Replace Selected — creates a Change Request requiring HR approval
	frm.fields_dict['worker_assignments'].grid.add_custom_button(
		__('Replace Selected'),
		() => {
			const selected = frm.fields_dict['worker_assignments'].grid.get_selected_children();
			if (!selected.length) {
				frappe.msgprint(__('Select the row of the employee you want to replace.'));
				return;
			}
			request_employee_change(frm, 'Replace Employee', selected[0].employee_name);
		}
	);

	// Smart Assign — only available when plan + tasks exist
	if (frm.doc.task_work_plan && (frm.doc.task_details || []).length) {
		frm.add_custom_button(__('Smart Assign'), () => {
			perform_smart_assign(frm);
		}, __('Assign'));
	}
}

/* ── Open a TW Employee Change Request (requires HR approval) ── */
function request_employee_change(frm, change_type, old_employee) {
	const fields = [
		{
			fieldtype: 'Link', fieldname: 'new_employee',
			label: 'New Employee', options: 'Task Worker', reqd: 1
		},
		{
			fieldtype: 'Link', fieldname: 'task',
			label: 'Limit to Task (optional)', options: 'Task'
		},
		{
			fieldtype: 'Small Text', fieldname: 'reason',
			label: 'Reason for Change', reqd: 1
		}
	];

	if (change_type === 'Replace Employee' && old_employee) {
		fields.unshift({
			fieldtype: 'Data', fieldname: 'old_employee_display',
			label: 'Employee Being Replaced', read_only: 1,
			default: old_employee
		});
	}

	frappe.prompt(
		fields,
		(vals) => {
			frappe.call({
				method: 'frappe.client.insert',
				args: {
					doc: {
						doctype: 'TW Employee Change Request',
						task_work_assignment: frm.doc.name,
						change_type: change_type,
						old_employee: change_type === 'Replace Employee' ? old_employee : null,
						new_employee: vals.new_employee,
						task: vals.task || null,
						reason: vals.reason
					}
				},
				callback(r) {
					if (r.message) {
						frappe.show_alert({
							message: __('Change Request {0} created – pending HR approval', [r.message.name]),
							indicator: 'blue'
						}, 6);
						frappe.set_route('Form', 'TW Employee Change Request', r.message.name);
					}
				}
			});
		},
		__(change_type),
		__('Submit for Approval')
	);
}

/* ── Smart Assign: rotate workers across days ───────────────── */
function perform_smart_assign(frm) {
	if (!frm.doc.start_date) {
		frappe.msgprint('Set a Start Date before running Smart Assign.');
		return;
	}
	const workers = frm._worker_list || [];
	if (!workers.length) {
		frappe.msgprint('No workers found in the linked Task Work Plan.');
		return;
	}

	frm.clear_table('worker_assignments');

	let rot_idx = 0;
	const summary = [];
	let current_date = frappe.datetime.str_to_obj(frm.doc.start_date);

	(frm.doc.task_details || []).forEach(td => {
		const total_work   = flt(td.total_work);
		const daily_target = flt(td.daily_target) || 1;
		const orig_days    = cint(td.days) || 1;
		const rate         = flt(td.rate);
		if (!total_work) return;

		const max_per_day  = workers.length * daily_target;
		const days_needed  = Math.ceil(total_work / max_per_day);
		let work_left      = total_work;
		const task_start   = new Date(current_date);
		const used_workers = new Set();

		for (let day = 0; day < days_needed && work_left > 0; day++) {
			const day_date     = new Date(task_start);
			day_date.setDate(day_date.getDate() + day);
			const work_today   = Math.min(work_left, max_per_day);
			const workers_today = Math.min(Math.ceil(work_today / daily_target), workers.length);

			for (let i = 0; i < workers_today && work_left > 0; i++) {
				const emp = workers[rot_idx % workers.length];
				const qty = flt(Math.min(daily_target, work_left), 2);

				const row = frm.add_child('worker_assignments');
				row.employee_name       = emp;
				row.task                = td.task;
				row.uom                 = td.uom;
				row.daily_target        = daily_target;
				row.rate                = rate;
				row.days                = 1;
				row.quantity_assigned   = qty;
				row.total_assigned_cost = flt(rate * qty, 2);
				row.assignment_date     = frappe.datetime.obj_to_str(day_date);

				used_workers.add(emp);
				work_left -= qty;
				rot_idx++;
			}
		}

		current_date.setDate(current_date.getDate() + days_needed);

		summary.push({
			task: td.task_name || td.task,
			needed: cint(td.workers) || 1,
			used:   used_workers.size,
			total:  total_work,
			per_day: max_per_day,
			orig:   orig_days,
			actual: days_needed
		});
	});

	// Set completion date to day before current_date pointer
	const comp = new Date(current_date);
	comp.setDate(comp.getDate() - 1);
	frm.set_value('completion_date', frappe.datetime.obj_to_str(comp));
	frm.refresh_field('worker_assignments');
	recalc_total_cost(frm);

	// Summary dialog
	const rows = summary.map(s => {
		const diff = s.actual - s.orig;
		const status = diff > 0 ? `<span class="text-danger">+${diff}d</span>` :
		               diff < 0 ? `<span class="text-success">${diff}d</span>` :
		               `<span class="text-success">On time</span>`;
		return `<tr>
			<td>${s.task}</td><td>${s.needed}</td><td>${s.used}</td>
			<td>${s.total}</td><td>${s.per_day.toFixed(1)}</td>
			<td>${s.orig}</td><td>${s.actual}</td><td>${status}</td>
		</tr>`;
	}).join('');

	frappe.msgprint({
		title: __('Smart Assign Complete'),
		message: `
			<table class="table table-bordered table-sm" style="font-size:12px;">
				<thead><tr>
					<th>Task</th><th>Req'd</th><th>Used</th><th>Total</th>
					<th>Work/Day</th><th>Orig Days</th><th>Actual Days</th><th>Status</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
			<p class="text-muted small">Workers rotate across tasks. Someone finishing early frees capacity for the next task.</p>`,
		indicator: 'green', wide: true
	});
}

// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

frappe.ui.form.on('Task Work Request', {
	refresh: function(frm) {
		set_stage_indicator(frm);
		render_pipeline(frm);

		// Auto-populate posting date on new doc
		if (frm.is_new() && !frm.doc.posting_date) {
			frm.set_value('posting_date', frappe.datetime.now_datetime());
		}

		if (frm.doc.docstatus === 1 && !frm.is_new()) {
			frm.add_custom_button(__('Task Work Plan'), function() {
				frappe.db.get_value('Task Work Plan',
					{ task_work_request_ref: frm.doc.name }, 'name'
				).then(r => {
					if (r.message && r.message.name) {
						// Plan already exists — open it
						frappe.set_route('Form', 'Task Work Plan', r.message.name);
					} else {
						frappe.new_doc('Task Work Plan', {
							task_work_request_ref: frm.doc.name,
							title: frm.doc.name,
							managers_name: frm.doc.farm_managers_name
						});
					}
				});
			}, __('Create'));
		}

		calculate_totals(frm);
	},

	validate: function(frm) {
		calculate_totals(frm);
	}
});

/* ── Task Request child table calculations ──────────────── */
frappe.ui.form.on('Task Request', {
	total_work:    (frm, cdt, cdn) => calculate_row(frm, cdt, cdn),
	daily_target:  (frm, cdt, cdn) => calculate_row(frm, cdt, cdn),
	days:          (frm, cdt, cdn) => calculate_row(frm, cdt, cdn),
	rate:          (frm, cdt, cdn) => calculate_row(frm, cdt, cdn),
	workers:       (frm, cdt, cdn) => calculate_row(frm, cdt, cdn),

	estimated_cost: function(frm) {
		setTimeout(() => calculate_totals(frm), 100);
	},
	task_request_details_add:    function(frm) { setTimeout(() => calculate_totals(frm), 300); },
	task_request_details_remove: function(frm) { setTimeout(() => calculate_totals(frm), 300); }
});

function calculate_row(frm, cdt, cdn) {
	let row = locals[cdt][cdn];
	const total_work   = parseInt(row.total_work)   || 0;
	const daily_target = parseInt(row.daily_target) || 0;
	const days         = parseInt(row.days)         || 0;
	const rate         = parseFloat(row.rate)       || 0;

	if (total_work && daily_target && days) {
		let workers_needed = Math.ceil((total_work / daily_target) / days);
		frappe.model.set_value(cdt, cdn, 'workers', workers_needed);

		if (rate > 0 && workers_needed > 0) {
			frappe.model.set_value(cdt, cdn, 'estimated_cost',
				rate * daily_target * workers_needed * days);
		}
	}
	setTimeout(() => calculate_totals(frm), 200);
}

function calculate_totals(frm) {
	let total_cost = 0, total_workers = 0;
	(frm.doc.task_request_details || []).forEach(row => {
		total_workers += parseInt(row.workers)        || 0;
		total_cost    += parseFloat(row.estimated_cost) || 0;
	});
	frm.set_value('estimated_cost',  total_cost);
	frm.set_value('total_workers',   total_workers);
}

/* ── Stage colour indicator ─────────────────────────────────── */
function set_stage_indicator(frm) {
	const colours = {
		'Requested': 'grey',
		'Planned':   'blue',
		'Assigned':  'green'
	};
	const stage = frm.doc.stage || 'Requested';
	frm.page.set_indicator(stage, colours[stage] || 'grey');
}

/* ── Pipeline progress section ──────────────────────────────── */
function render_pipeline(frm) {
	if (frm.is_new()) return;

	const stage_order = ['Requested', 'Planned', 'Assigned'];
	const stage_idx   = stage_order.indexOf(frm.doc.stage || 'Requested');
	const pct         = Math.round(((stage_idx + 1) / stage_order.length) * 100);
	const bar_color   = { 0: '#6c757d', 1: '#007bff', 2: '#28a745' }[stage_idx] || '#6c757d';

	const html = `
		<div style="padding:10px 0 6px;">
			<!-- Progress bar -->
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
				<span class="text-muted small" style="white-space:nowrap;">Progress</span>
				<div style="flex:1;background:#e9ecef;border-radius:4px;height:6px;">
					<div style="width:${pct}%;height:6px;background:${bar_color};border-radius:4px;transition:width 0.4s;"></div>
				</div>
				<span class="text-muted small">${frm.doc.stage || 'Requested'}</span>
			</div>
			<!-- Stage tiles -->
			<div style="display:flex;gap:0;align-items:stretch;">
				${stage_order.map((s, i) => {
					const done   = i < stage_idx;
					const active = i === stage_idx;
					const bg     = done ? '#28a745' : active ? bar_color : '#e9ecef';
					const fg     = (done || active) ? '#fff' : '#6c757d';
					return `<div style="flex:1;text-align:center;padding:5px 2px;background:${bg};color:${fg};font-size:10px;font-weight:${active ? 600 : 400};
						border-radius:${i === 0 ? '4px 0 0 4px' : i === stage_order.length-1 ? '0 4px 4px 0' : '0'};
						border-right:${i < stage_order.length-1 ? '1px solid rgba(255,255,255,0.3)' : 'none'};">
						${s}
					</div>`;
				}).join('')}
			</div>
		</div>`;

	frm.dashboard.add_section(html, __('Pipeline'));
}

// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

frappe.ui.form.on('Task Work Request', {
    refresh: function(frm) {
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
                        frappe.set_route('Form', 'Task Work Plan', r.message.name);
                    } else {
                        frappe.new_doc('Task Work Plan', {
                            task_work_request_ref: frm.doc.name,
                            title: frm.doc.name,
                            managers_name: frm.doc.farm_managers_name,
                            no_of_approved_workers: frm.doc.total_workers,
                            approved_estimated_cost: frm.doc.estimated_cost
                        });
                    }
                });
            }, __('Create'));
        }

        calculate_totals(frm);
        render_pipeline(frm);
        render_payment_summary(frm);
    },

    validate: function(frm) {
        calculate_totals(frm);
        return validate_payment_dates(frm);
    },

    before_submit: function(frm) {
        // Ensure all tasks have valid calculations
        let invalid_rows = (frm.doc.task_request_details || []).filter(row => 
            !row.workers || row.workers < 1 || !row.estimated_cost || row.estimated_cost <= 0
        );
        
        if (invalid_rows.length > 0) {
            frappe.msgprint(__('Please ensure all tasks have valid worker count and estimated cost before submitting.'));
            frappe.validated = false;
        }
    }
});

/* ── Task Request child table calculations ──────────────── */
frappe.ui.form.on('Task Request', {
    total_work: function(frm, cdt, cdn) {
        calculate_row(frm, cdt, cdn);
    },
    
    daily_target: function(frm, cdt, cdn) {
        calculate_row(frm, cdt, cdn);
    },
    
    days: function(frm, cdt, cdn) {
        calculate_row(frm, cdt, cdn);
    },
    
    rate: function(frm, cdt, cdn) {
        calculate_row(frm, cdt, cdn);
    },
    
    workers: function(frm, cdt, cdn) {
        calculate_row(frm, cdt, cdn);
    },
    
    payment_type: function(frm, cdt, cdn) {
        calculate_row(frm, cdt, cdn);
        toggle_rate_label(frm, cdt, cdn);
    },
    
    start_date: function(frm, cdt, cdn) {
        calculate_days_from_dates(frm, cdt, cdn);
    },
    
    end_date: function(frm, cdt, cdn) {
        calculate_days_from_dates(frm, cdt, cdn);
    },

    task_request_details_add: function(frm) {
        setTimeout(() => calculate_totals(frm), 300);
    },
    
    task_request_details_remove: function(frm) {
        setTimeout(() => calculate_totals(frm), 300);
    }
});

function toggle_rate_label(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let field = frappe.meta.get_docfield("Task Request", "rate", cdn);
    if (field) {
        if (row.payment_type === 'Per Unit') {
            field.label = 'Rate per Unit';
        } else if (row.payment_type === 'Per Day') {
            field.label = 'Daily Rate per Worker';
        } else if (row.payment_type === 'Per Task') {
            field.label = 'Fixed Task Rate';
        }
        refresh_field("task_request_details");
    }
}

function calculate_days_from_dates(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (row.start_date && row.end_date) {
        let days = frappe.datetime.get_diff(row.end_date, row.start_date) + 1;
        if (days > 0) {
            frappe.model.set_value(cdt, cdn, 'days', days);
        } else {
            frappe.msgprint(__('Row #{0}: End date must be after start date', [row.idx]));
            frappe.model.set_value(cdt, cdn, 'end_date', '');
        }
    }
}

function calculate_row(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    const total_work = parseFloat(row.total_work) || 0;
    const daily_target = parseFloat(row.daily_target) || 0;
    const days = parseInt(row.days) || 0;
    const rate = parseFloat(row.rate) || 0;
    const payment_type = row.payment_type || 'Per Unit';

    if (total_work > 0 && daily_target > 0 && days > 0) {
        // Calculate workers needed based on workload
        let total_daily_work_required = total_work / days;
        let workers_needed = Math.ceil(total_daily_work_required / daily_target);
        workers_needed = Math.max(1, workers_needed); // Ensure at least 1 worker
        
        frappe.model.set_value(cdt, cdn, 'workers', workers_needed);

        // Calculate payment based on type
        if (rate > 0) {
            let total_payment = 0;
            let per_worker_payment = 0;
            
            if (payment_type === 'Per Unit') {
                total_payment = total_work * rate;
                per_worker_payment = (total_work * rate) / workers_needed;
            } else if (payment_type === 'Per Day') {
                total_payment = workers_needed * days * rate;
                per_worker_payment = rate * days;
            } else if (payment_type === 'Per Task') {
                total_payment = rate;
                per_worker_payment = rate / workers_needed;
            }
            
            frappe.model.set_value(cdt, cdn, 'estimated_cost', total_payment);
            frappe.model.set_value(cdt, cdn, 'per_worker_payment', per_worker_payment);
            
            // Show calculation hint
            frappe.show_alert({
                message: __(`Row #{0}: Calculated payment: {1}`, [row.idx, format_currency(total_payment)]),
                indicator: 'green'
            }, 3);
        }
    }
    setTimeout(() => calculate_totals(frm), 200);
}

function calculate_totals(frm) {
    let total_cost = 0;
    let total_workers = 0;
    (frm.doc.task_request_details || []).forEach(row => {
        total_workers += parseInt(row.workers) || 0;
        total_cost    += parseFloat(row.estimated_cost) || 0;
    });
    frm.set_value('estimated_cost', total_cost);
    frm.set_value('total_workers',  total_workers);
}

function validate_payment_dates(frm) {
    let has_error = false;
    (frm.doc.task_request_details || []).forEach(row => {
        if (row.start_date && row.end_date) {
            if (frappe.datetime.get_diff(row.end_date, row.start_date) < 0) {
                frappe.msgprint(__('Row #{0}: End date must be after start date', [row.idx]));
                has_error = true;
            }
            
            // Check if dates are in the past (optional validation)
            let today = frappe.datetime.nowdate();
            if (row.start_date < today) {
                frappe.msgprint(__('Row #{0}: Start date is in the past. Please confirm.', [row.idx]));
            }
        }
    });
    return !has_error;
}

function render_pipeline(frm) {
    if (frm.is_new()) return;

    const stages   = ['Requested', 'Planned', 'Assigned'];
    const curr_idx = stages.indexOf(frm.doc.stage || 'Requested');

    const steps = stages.map((s, i) => {
        const done   = i < curr_idx;
        const active = i === curr_idx;
        const dot_style = done
            ? 'width:6px;height:6px;border-radius:50%;background:#adb5bd;flex-shrink:0'
            : active
                ? 'width:7px;height:7px;border-radius:50%;background:#5e64ff;flex-shrink:0'
                : 'width:6px;height:6px;border-radius:50%;border:1.5px solid #dee2e6;background:#fff;flex-shrink:0';
        const text_style = done
            ? 'font-size:11px;color:#adb5bd'
            : active
                ? 'font-size:11px;color:#333;font-weight:600'
                : 'font-size:11px;color:#dee2e6';
        const connector = i < stages.length - 1
            ? `<div style="flex:1;height:1px;background:${done ? '#adb5bd' : '#e9ecef'};margin:0 8px;min-width:16px"></div>`
            : '';
        return `<div style="display:flex;align-items:center;gap:5px">
                    <div style="${dot_style}"></div>
                    <span style="${text_style}">${s}</span>
                </div>${connector}`;
    }).join('');

    frm.dashboard.add_section(
        `<div style="display:flex;align-items:center;padding:4px 2px">${steps}</div>`
    );
}

function render_payment_summary(frm) {
    if (frm.is_new()) return;
    const rows = frm.doc.task_request_details || [];
    if (!rows.length) return;

    const fmt = v => format_currency(v || 0);

    // Totals
    const grand_total    = rows.reduce((s, r) => s + flt(r.estimated_cost), 0);
    const total_workers  = rows.reduce((s, r) => s + (parseInt(r.workers) || 0), 0);
    const by_type        = { 'Per Unit': 0, 'Per Day': 0, 'Per Task': 0 };
    rows.forEach(r => {
        if (by_type[r.payment_type] !== undefined)
            by_type[r.payment_type] += flt(r.estimated_cost);
    });

    // Per-task rows
    const task_rows = rows.map(r => {
        const per_worker = (parseInt(r.workers) || 1) > 0
            ? flt(r.estimated_cost) / (parseInt(r.workers) || 1)
            : 0;
        return `<tr style="border-bottom:1px solid #f5f5f5">
            <td style="padding:5px 8px;font-size:12px">${r.task_name || '—'}</td>
            <td style="padding:5px 8px;font-size:11px;color:#6c757d;white-space:nowrap">${r.payment_type || '—'}</td>
            <td style="padding:5px 8px;font-size:12px;text-align:right">${r.workers || 0}</td>
            <td style="padding:5px 8px;font-size:12px;text-align:right">${r.days || 0}</td>
            <td style="padding:5px 8px;font-size:12px;text-align:right">${fmt(r.rate)}</td>
            <td style="padding:5px 8px;font-size:12px;text-align:right;font-weight:600">${fmt(r.estimated_cost)}</td>
            <td style="padding:5px 8px;font-size:11px;text-align:right;color:#6c757d">${fmt(per_worker)}</td>
        </tr>`;
    }).join('');

    // Payment type breakdown — only show types that have a non-zero value
    const breakdown = Object.entries(by_type)
        .filter(([, v]) => v > 0)
        .map(([type, val]) => {
            const pct = grand_total > 0 ? Math.round(val / grand_total * 100) : 0;
            return `<div style="flex:1;min-width:0">
                <div style="font-size:10px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${type}</div>
                <div style="font-size:13px;font-weight:600;color:#333">${fmt(val)}</div>
                <div style="margin-top:4px;height:3px;background:#e9ecef;border-radius:2px">
                    <div style="width:${pct}%;height:100%;background:#5e64ff;border-radius:2px"></div>
                </div>
                <div style="font-size:10px;color:#aaa;margin-top:2px">${pct}%</div>
            </div>`;
        }).join('<div style="width:1px;background:#f0f0f0;margin:0 12px;align-self:stretch"></div>');

    const html = `
        <div style="padding:0 2px">
            <!-- Key figures -->
            <div style="display:flex;gap:24px;padding:4px 6px 10px;border-bottom:1px solid #f0f0f0;margin-bottom:8px;font-size:11px;color:#6c757d">
                <span>Tasks: <strong style="color:#333">${rows.length}</strong></span>
                <span>Workers: <strong style="color:#333">${total_workers}</strong></span>
                <span>Estimated Cost: <strong style="color:#333">${fmt(grand_total)}</strong></span>
            </div>
            <!-- Per-task table -->
            <table style="width:100%;border-collapse:collapse">
                <thead>
                    <tr>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:left;text-transform:uppercase;letter-spacing:.5px">Task</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:left;text-transform:uppercase;letter-spacing:.5px">Type</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:right;text-transform:uppercase;letter-spacing:.5px">Workers</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:right;text-transform:uppercase;letter-spacing:.5px">Days</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:right;text-transform:uppercase;letter-spacing:.5px">Rate</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:right;text-transform:uppercase;letter-spacing:.5px">Total</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:right;text-transform:uppercase;letter-spacing:.5px">Per Worker</th>
                    </tr>
                </thead>
                <tbody>${task_rows}</tbody>
            </table>
            <!-- Payment type breakdown -->
            ${breakdown ? `<div style="display:flex;gap:0;margin-top:12px;padding-top:10px;border-top:1px solid #f0f0f0">${breakdown}</div>` : ''}
        </div>`;

    frm.dashboard.add_section(html, __('Payment Breakdown'));
}
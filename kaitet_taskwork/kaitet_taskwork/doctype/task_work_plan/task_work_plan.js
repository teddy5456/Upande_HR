// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

frappe.ui.form.on('Task Work Plan', {
    refresh: function(frm) {
        set_stage_indicator(frm);

        // Auto-populate posting date on new doc
        if (frm.is_new() && !frm.doc.posting_date) {
            frm.set_value('posting_date', frappe.datetime.now_datetime());
        }

        // Add understaffing management buttons for draft docs
        if (frm.doc.docstatus === 0 && !frm.is_new()) {
            frm.add_custom_button(__('Check Worker Availability'), function() {
                check_worker_availability(frm);
            }, __('Planning'));

            frm.add_custom_button(__('Optimize Task Distribution'), function() {
                optimize_task_distribution(frm);
            }, __('Planning'));
            
            frm.add_custom_button(__('Handle Understaffing'), function() {
                handle_understaffing(frm);
            }, __('Planning'));

            frm.add_custom_button(__('Auto Schedule Tasks'), function() {
                auto_schedule_tasks(frm);
            }, __('Planning'));
        }

        // Add assignment button for submitted docs
        if (frm.doc.docstatus === 1 && !frm.is_new()) {
            frm.add_custom_button(__('Task Work Assignment'), function() {
                frappe.db.get_value('Task Work Assignment',
                    { task_work_plan: frm.doc.name }, 'name'
                ).then(r => {
                    if (r.message && r.message.name) {
                        frappe.set_route('Form', 'Task Work Assignment', r.message.name);
                    } else {
                        frappe.new_doc('Task Work Assignment', {
                            task_work_plan: frm.doc.name,
                            task_work_request: frm.doc.task_work_request_ref,
                            title: frm.doc.title,
                            start_date: frm.doc.custom_expected_start_date,
                            farm_manager: frm.doc.managers_name,
                            business_unit: frm.doc.business_unit,
                            cost_centre: frm.doc.cost_centre
                        });
                    }
                });
            }, __('Create'));
        }

        render_plan_summary(frm);
    },

    // Load request details when reference is set
    task_work_request_ref: function(frm) {
        if (frm.doc.task_work_request_ref) {
            frm.set_value('title', frm.doc.task_work_request_ref);
            load_request_details(frm);
        }
    },

    validate: function(frm) {
        if (!frm.doc.custom_expected_start_date) {
            frappe.msgprint(__("Expected Start Date is required."));
            frappe.validated = false;
            return false;
        }
        
        if (!validate_employee_count(frm)) {
            return false;
        }
        
        if (!validate_task_timelines(frm)) {
            return false;
        }
        
        return true;
    },
    
    before_submit: function(frm) {
        // Final validation before submission
        let understaffed = (frm.doc.entries || []).filter(r => r.understaffed).length;
        if (understaffed > 0) {
            frappe.msgprint({
                title: __('⚠️ Understaffed Tasks'),
                indicator: 'orange',
                message: __('{0} tasks are understaffed. Timeline has been adjusted accordingly.', [understaffed])
            });
        }
    }
});

/* ── Task Plan child table ───────────────────────────────── */
frappe.ui.form.on('Task Plan', {
    // Filter employee_name to Active Task Workers only
    employee_name: function(frm, cdt, cdn) {
        frm.set_query('employee_name', 'entries', function() {
            return {
                filters: [
                    ['Task Worker', 'status', '=', 'Active']
                ]
            };
        });
        validate_employee_count(frm);
    },
    
    workers_required: function(frm, cdt, cdn) {
        check_task_availability(frm, cdt, cdn);
    },
    
    workers_available: function(frm, cdt, cdn) {
        check_understaffing_for_row(frm, cdt, cdn);
    },
    
    start_date: function(frm, cdt, cdn) {
        validate_task_dates(frm, cdt, cdn);
        calculate_task_duration(frm, cdt, cdn);
    },
    
    end_date: function(frm, cdt, cdn) {
        validate_task_dates(frm, cdt, cdn);
        calculate_task_duration(frm, cdt, cdn);
    },
    
    entries_add: function(frm) {
        setTimeout(() => validate_employee_count(frm), 100);
        setTimeout(() => check_worker_availability(frm), 200);
    },
    
    entries_remove: function(frm) {
        setTimeout(() => validate_employee_count(frm), 100);
        setTimeout(() => check_worker_availability(frm), 200);
    }
});

function load_request_details(frm) {
    frappe.call({
        method: "frappe.client.get",
        args: {
            doctype: "Task Work Request",
            name: frm.doc.task_work_request_ref
        },
        callback: function(r) {
            if (r.message) {
                let request = r.message;
                
                // Clear existing entries
                frm.clear_table("entries");
                
                // Copy request details to plan
                (request.task_request_details || []).forEach(req => {
                    let row = frm.add_child("entries");
                    row.task_name = req.task_name || 'Task';
                    row.workers_required = req.workers || 1;
                    row.start_date = req.start_date;
                    row.end_date = req.end_date;
                    row.daily_target = req.daily_target;
                    row.total_work = req.total_work;
                    row.payment_type = req.payment_type;
                    row.rate = req.rate;
                    row.uom = req.uom;
                    
                    // Initially set available based on approved workers
                    row.workers_available = frm.doc.no_of_approved_workers || req.workers || 1;
                    row.workers_assigned = Math.min(row.workers_available, row.workers_required);
                });
                
                frm.refresh_field("entries");
                
                // Check availability after loading
                setTimeout(() => check_worker_availability(frm), 500);
                
                frappe.show_alert({
                    message: __('Loaded {0} tasks from request', [request.task_request_details.length]),
                    indicator: 'green'
                }, 3);
            }
        }
    });
}

function check_worker_availability(frm) {
    if (!frm.doc.entries || frm.doc.entries.length === 0) {
        return;
    }
    
    frappe.call({
        method: "kaitet_taskwork.kaitet_taskwork.doctype.task_work_plan.task_work_plan.check_worker_availability",
        args: {
            plan_name: frm.doc.name,
            tasks: frm.doc.entries,
            unit: frm.doc.unitdivision,
            start_date: frm.doc.custom_expected_start_date
        },
        callback: function(r) {
            if (r.message) {
                update_availability_data(frm, r.message);
            }
        }
    });
}

function update_availability_data(frm, availability) {
    let understaffed_count = 0;
    let timeline_adjusted = false;
    
    availability.forEach(data => {
        let row = (frm.doc.entries || []).find(r => r.task_name === data.task_name);
        if (row) {
            frappe.model.set_value(row.doctype, row.name, 'workers_available', data.workers_available);
            
            // Check if understaffed
            if (data.workers_available < row.workers_required) {
                understaffed_count++;
                frappe.model.set_value(row.doctype, row.name, 'understaffed', 1);
                frappe.model.set_value(row.doctype, row.name, 'workers_assigned', data.workers_available);
                
                // Adjust timeline based on available workers
                let adjusted = adjust_task_timeline(row, data.workers_available);
                if (adjusted) timeline_adjusted = true;
            } else {
                frappe.model.set_value(row.doctype, row.name, 'understaffed', 0);
                frappe.model.set_value(row.doctype, row.name, 'workers_assigned', row.workers_required);
            }
        }
    });
    
    frm.set_value('understaffed_tasks', understaffed_count);
    frm.refresh_field('entries');
    
    if (understaffed_count > 0) {
        let message = __('⚠️ {0} tasks are understaffed. ', [understaffed_count]);
        if (timeline_adjusted) {
            message += __('Task durations have been automatically extended.');
        }
        frappe.show_alert({
            message: message,
            indicator: 'orange'
        }, 5);
    } else {
        frappe.show_alert({
            message: __('✅ All tasks have sufficient workers'),
            indicator: 'green'
        }, 3);
    }
}

function adjust_task_timeline(row, available_workers) {
    if (!row.start_date || !row.end_date || !row.total_work) return false;
    
    let original_days = frappe.datetime.get_diff(row.end_date, row.start_date) + 1;
    if (original_days <= 0) return false;
    
    let efficiency_ratio = available_workers / row.workers_required;
    let new_days_needed = Math.ceil(original_days / efficiency_ratio);
    
    if (new_days_needed > original_days) {
        let new_end_date = frappe.datetime.add_days(row.start_date, new_days_needed - 1);
        frappe.model.set_value(row.doctype, row.name, 'end_date', new_end_date);
        
        // Recalculate daily target for remaining work
        let new_daily_target = Math.ceil(row.total_work / (new_days_needed * available_workers));
        frappe.model.set_value(row.doctype, row.name, 'adjusted_daily_target', new_daily_target);
        
        return true;
    }
    return false;
}

function handle_understaffing(frm) {
    let understaffed_tasks = [];
    let total_shortage = 0;
    let total_workers_available = frm.doc.no_of_approved_workers || 0;
    
    (frm.doc.entries || []).forEach(row => {
        if (row.workers_available < row.workers_required) {
            understaffed_tasks.push({
                name: row.task_name,
                required: row.workers_required,
                available: row.workers_available,
                shortage: row.workers_required - row.workers_available,
                current_end: row.end_date,
                original_days: row.start_date && row.end_date ? 
                    frappe.datetime.get_diff(row.end_date, row.start_date) + 1 : 0
            });
            total_shortage += row.workers_required - row.workers_available;
        }
    });
    
    if (understaffed_tasks.length === 0) {
        frappe.msgprint(__('✅ All tasks have sufficient workers. No understaffing detected.'));
        return;
    }
    
    let html = `
        <div style="padding: 10px;">
            <h4>Understaffing Analysis</h4>
            <p><strong>Total Worker Shortage:</strong> ${total_shortage} workers</p>
            <p><strong>Available Workers Pool:</strong> ${total_workers_available}</p>
            <table class="table table-bordered" style="margin-top: 15px;">
                <thead>
                    <tr>
                        <th>Task</th>
                        <th>Required</th>
                        <th>Available</th>
                        <th>Shortage</th>
                        <th>Original Days</th>
                        <th>Adjusted End Date</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    understaffed_tasks.forEach(t => {
        html += `<tr>
            <td>${t.name}</td>
            <td class="text-center">${t.required}</td>
            <td class="text-center text-danger">${t.available}</td>
            <td class="text-center text-danger"><strong>${t.shortage}</strong></td>
            <td class="text-center">${t.original_days}</td>
            <td>${t.current_end || 'Not set'}</td>
        </tr>`;
    });
    
    html += `</tbody></table>
        <br>
        <h5>📋 Recommended Actions:</h5>
        <ul>
            <li>Task durations have been automatically extended based on available workers</li>
            <li>Consider requesting <strong>${total_shortage}</strong> additional workers for critical tasks</li>
            <li>Prioritize high-priority tasks if timeline is critical</li>
            <li>Review task dependencies and adjust sequencing if needed</li>
        </ul>
        
        <div style="margin-top: 20px; padding: 15px; background-color: #fff3e0; border-left: 4px solid #ff9800;">
            <strong>⚠️ Impact Analysis:</strong> The project completion date may be delayed due to understaffing. 
            Consider resource reallocation or timeline adjustment at the project level.
        </div>
    </div>`;
    
    frappe.msgprint({
        title: __('Understaffing Resolution'),
        message: html,
        indicator: 'orange',
        wide: true
    });
}

function optimize_task_distribution(frm) {
    let workers_pool = frm.doc.no_of_approved_workers || 0;
    if (workers_pool === 0) {
        frappe.msgprint(__('No approved workers available. Please set approved workers count first.'));
        return;
    }
    
    let tasks = frm.doc.entries || [];
    if (tasks.length === 0) {
        frappe.msgprint(__('No tasks to optimize.'));
        return;
    }
    
    // Sort tasks by priority (if available) or by work volume
    let sorted_tasks = tasks.sort((a, b) => {
        // Prioritize tasks with earlier dates first
        if (a.start_date && b.start_date) {
            return new Date(a.start_date) - new Date(b.start_date);
        }
        return (b.total_work || 0) - (a.total_work || 0);
    });
    
    let allocation = [];
    let remaining_workers = workers_pool;
    let total_required = tasks.reduce((sum, t) => sum + (t.workers_required || 0), 0);
    
    if (total_required > workers_pool) {
        frappe.msgprint({
            title: __('⚠️ Resource Constraint'),
            indicator: 'orange',
            message: __('Total workers required ({0}) exceeds available pool ({1}). Tasks will be prioritized.', 
                [total_required, workers_pool])
        });
    }
    
    sorted_tasks.forEach(task => {
        let allocated = Math.min(task.workers_required || 0, remaining_workers);
        let shortfall = (task.workers_required || 0) - allocated;
        
        allocation.push({
            task: task.task_name,
            required: task.workers_required,
            allocated: allocated,
            shortfall: shortfall,
            start_date: task.start_date,
            end_date: task.end_date
        });
        
        remaining_workers -= allocated;
        
        // Update task with allocated workers
        frappe.model.set_value(task.doctype, task.name, 'workers_assigned', allocated);
        if (allocated < task.workers_required) {
            frappe.model.set_value(task.doctype, task.name, 'understaffed', 1);
            adjust_task_timeline(task, allocated);
        } else {
            frappe.model.set_value(task.doctype, task.name, 'understaffed', 0);
        }
    });
    
    // Show allocation summary
    let html = `
        <div style="padding: 10px;">
            <h4>Optimized Worker Distribution</h4>
            <p><strong>Total Workers Available:</strong> ${workers_pool}</p>
            <p><strong>Total Workers Required:</strong> ${total_required}</p>
            <p><strong>Remaining Workers After Allocation:</strong> ${remaining_workers}</p>
            
            <table class="table table-bordered" style="margin-top: 15px;">
                <thead>
                    <tr>
                        <th>Task</th>
                        <th>Required</th>
                        <th>Allocated</th>
                        <th>Shortfall</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    allocation.forEach(a => {
        let status = a.shortfall > 0 ? 
            `<span class="text-danger">⚠️ Understaffed (-${a.shortfall})</span>` : 
            '<span class="text-success">✅ Fully Staffed</span>';
        
        let row_class = a.shortfall > 0 ? 'class="text-danger"' : '';
        
        html += `<tr ${row_class}>
            <td>${a.task}</td>
            <td class="text-center">${a.required}</td>
            <td class="text-center">${a.allocated}</td>
            <td class="text-center">${a.shortfall > 0 ? a.shortfall : '-'}</td>
            <td>${status}</td>
        </tr>`;
    });
    
    html += `</tbody></table>
        
        <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 4px;">
            <h5>📊 Optimization Summary:</h5>
            <ul>
                <li>Tasks have been prioritized by start date and workload</li>
                <li>${allocation.filter(a => a.shortfall > 0).length} tasks are understaffed</li>
                <li>Timelines adjusted for understaffed tasks</li>
            </ul>
        </div>
    </div>`;
    
    frappe.msgprint({
        title: __('Optimization Complete'),
        message: html,
        indicator: 'green',
        wide: true
    });
    
    frm.refresh_field('entries');
}

function auto_schedule_tasks(frm) {
    if (!frm.doc.custom_expected_start_date) {
        frappe.msgprint(__('Please set Expected Start Date first.'));
        return;
    }
    
    let tasks = frm.doc.entries || [];
    if (tasks.length === 0) return;
    
    let current_date = new Date(frm.doc.custom_expected_start_date);
    let schedule_summary = [];
    
    tasks.forEach((task, index) => {
        if (!task.start_date) {
            // Set start date based on current pointer
            let start_date = frappe.datetime.obj_to_str(current_date);
            frappe.model.set_value(task.doctype, task.name, 'start_date', start_date);
            
            // Calculate end date based on duration
            let duration = task.days || 1;
            let end_date = new Date(current_date);
            end_date.setDate(end_date.getDate() + duration - 1);
            frappe.model.set_value(task.doctype, task.name, 'end_date', frappe.datetime.obj_to_str(end_date));
            
            // Move current date forward
            current_date.setDate(current_date.getDate() + duration);
            
            schedule_summary.push({
                task: task.task_name,
                start: start_date,
                end: frappe.datetime.obj_to_str(end_date),
                duration: duration
            });
        }
    });
    
    // Show schedule summary
    if (schedule_summary.length > 0) {
        let html = '<h4>Task Schedule Generated</h4><table class="table table-bordered">';
        html += '<tr><th>Task</th><th>Start Date</th><th>End Date</th><th>Duration (Days)</th></tr>';
        
        schedule_summary.forEach(s => {
            html += `<tr>
                <td>${s.task}</td>
                <td>${s.start}</td>
                <td>${s.end}</td>
                <td class="text-center">${s.duration}</td>
            </tr>`;
        });
        
        html += '</table>';
        
        frappe.msgprint({
            title: __('Auto Schedule Complete'),
            message: html,
            indicator: 'green'
        });
    }
    
    frm.refresh_field('entries');
}

function check_understaffing_for_row(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (row.workers_available < row.workers_required) {
        frappe.model.set_value(cdt, cdn, 'understaffed', 1);
        frappe.model.set_value(cdt, cdn, 'workers_assigned', row.workers_available);
        
        frappe.show_alert({
            message: __(`Task "${row.task_name}" is understaffed. Timeline adjusted.`),
            indicator: 'orange'
        }, 5);
    } else {
        frappe.model.set_value(cdt, cdn, 'understaffed', 0);
        frappe.model.set_value(cdt, cdn, 'workers_assigned', row.workers_required);
    }
}

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
        return false;
    }
    return true;
}

function validate_task_timelines(frm) {
    let has_overlap = false;
    let tasks = frm.doc.entries || [];
    
    for (let i = 0; i < tasks.length; i++) {
        for (let j = i + 1; j < tasks.length; j++) {
            if (tasks[i].start_date && tasks[i].end_date && 
                tasks[j].start_date && tasks[j].end_date) {
                
                let start1 = new Date(tasks[i].start_date);
                let end1 = new Date(tasks[i].end_date);
                let start2 = new Date(tasks[j].start_date);
                let end2 = new Date(tasks[j].end_date);
                
                // Check for overlap
                if (start1 <= end2 && start2 <= end1) {
                    has_overlap = true;
                    frappe.msgprint({
                        title: __('⚠️ Task Overlap'),
                        indicator: 'orange',
                        message: __('Tasks "{0}" and "{1}" have overlapping timelines. Consider adjusting dates.', 
                            [tasks[i].task_name, tasks[j].task_name])
                    });
                }
            }
        }
    }
    
    return true; // Don't block submission, just warn
}

function validate_task_dates(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (row.start_date && row.end_date) {
        if (row.end_date < row.start_date) {
            frappe.msgprint(__('Row: {0} - End date must be after start date', [row.task_name]));
            frappe.model.set_value(cdt, cdn, 'end_date', '');
            return false;
        }
    }
    return true;
}

function calculate_task_duration(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (row.start_date && row.end_date) {
        let days = frappe.datetime.get_diff(row.end_date, row.start_date) + 1;
        if (days > 0) {
            frappe.model.set_value(cdt, cdn, 'duration_days', days);
        }
    }
}

function check_task_availability(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (row.workers_required > (frm.doc.no_of_approved_workers || 0)) {
        frappe.msgprint({
            title: __('⚠️ Insufficient Workers'),
            indicator: 'orange',
            message: __('Task "{0}" requires {1} workers but only {2} are approved total.', 
                [row.task_name, row.workers_required, frm.doc.no_of_approved_workers])
        });
    }
}

function set_stage_indicator(frm) {
    const colours = {
        'Planned': 'blue',
        'Assigned': 'orange',
        'In Progress': 'yellow',
        'Completed': 'green'
    };
    const stage = frm.doc.stage || 'Planned';
    frm.page.set_indicator(stage, colours[stage] || 'blue');
}

function render_plan_summary(frm) {
    if (frm.is_new()) return;
    const entries = frm.doc.entries || [];
    if (!entries.length) return;

    // --- Worker conflict detection (same worker, overlapping date ranges) ---
    const conflicts = [];
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            const a = entries[i], b = entries[j];
            if (!a.task_worker || a.task_worker !== b.task_worker) continue;
            if (!a.start_date || !a.end_date || !b.start_date || !b.end_date) continue;
            if (new Date(a.start_date) <= new Date(b.end_date) &&
                new Date(b.start_date) <= new Date(a.end_date)) {
                conflicts.push({
                    worker: a.worker_name || a.task_worker,
                    taskA:  a.task_name || a.task_worker,
                    taskB:  b.task_name || b.task_worker,
                    dates:  `${a.start_date} – ${b.end_date}`
                });
            }
        }
    }

    // --- Helper: mini progress bar ---
    const bar = (available, required) => {
        if (!required) return '<span style="color:#aaa;font-size:11px">—</span>';
        const pct   = Math.min(100, Math.round(available / required * 100));
        const color = pct >= 100 ? '#28a745' : pct >= 60 ? '#e6a817' : '#dc3545';
        return `<div style="display:flex;align-items:center;gap:6px">
            <div style="width:56px;height:5px;background:#e9ecef;border-radius:3px;flex-shrink:0">
                <div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div>
            </div>
            <span style="font-size:11px;color:${color};font-weight:600;min-width:28px">${available}/${required}</span>
        </div>`;
    };

    // --- Helper: timeline impact badge ---
    const impact = (row) => {
        if (!row.understaffed) {
            return '<span style="color:#28a745;font-size:11px">On time</span>';
        }
        const avail = row.workers_available || 0;
        const req   = row.workers_required  || 1;
        if (!avail || !row.start_date || !row.end_date) {
            return '<span style="color:#dc3545;font-size:11px">Delayed</span>';
        }
        const orig_days = frappe.datetime.get_diff(row.end_date, row.start_date) + 1;
        const delay     = Math.ceil(orig_days / (avail / req)) - orig_days;
        return `<span style="color:#dc3545;font-size:11px">+${delay}d</span>`;
    };

    // --- Summary totals ---
    const total_req    = entries.reduce((s, r) => s + (r.workers_required || 0), 0);
    const total_avail  = entries.reduce((s, r) => s + (r.workers_available || r.workers_required || 0), 0);
    const n_under      = entries.filter(r => r.understaffed).length;
    const approved     = frm.doc.no_of_approved_workers || 0;

    const status_color = n_under > 0 ? '#dc3545' : '#28a745';
    const status_text  = n_under > 0
        ? `${n_under} task${n_under > 1 ? 's' : ''} understaffed`
        : 'Fully staffed';

    // --- Table rows ---
    const rows_html = entries.map(r => {
        const avail = (r.workers_available != null) ? r.workers_available : (r.workers_required || 0);
        const req   = r.workers_required || 0;
        const date_range = (r.start_date && r.end_date)
            ? `${r.start_date} – ${r.end_date}`
            : '<span style="color:#aaa">Not set</span>';
        return `<tr style="border-bottom:1px solid #f5f5f5">
            <td style="padding:5px 8px;font-size:12px">${r.task_name || '—'}</td>
            <td style="padding:5px 8px">${bar(avail, req)}</td>
            <td style="padding:5px 8px;font-size:11px;color:#6c757d;white-space:nowrap">${date_range}</td>
            <td style="padding:5px 8px">${impact(r)}</td>
        </tr>`;
    }).join('');

    // --- Conflict block ---
    const conflict_html = conflicts.length
        ? `<div style="margin-top:10px;padding:7px 10px;background:#fff8e1;border-left:3px solid #e6a817;border-radius:2px;font-size:11px">
            <strong style="color:#7c5800">Worker conflicts</strong>
            ${conflicts.map(c =>
                `<div style="margin-top:3px;color:#555">${c.worker} &mdash; <em>${c.taskA}</em> overlaps with <em>${c.taskB}</em></div>`
            ).join('')}
           </div>`
        : '';

    const html = `
        <div style="padding:0 2px">
            <div style="display:flex;gap:24px;padding:4px 6px 8px;border-bottom:1px solid #f0f0f0;margin-bottom:6px;font-size:11px;color:#6c757d">
                <span>Approved: <strong style="color:#333">${approved}</strong></span>
                <span>Required: <strong style="color:#333">${total_req}</strong></span>
                <span>Available: <strong style="color:${total_avail < total_req ? '#dc3545' : '#28a745'}">${total_avail}</strong></span>
                <span style="color:${status_color};font-weight:600">${status_text}</span>
            </div>
            <table style="width:100%;border-collapse:collapse">
                <thead>
                    <tr>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:left;text-transform:uppercase;letter-spacing:.5px">Task</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:left;text-transform:uppercase;letter-spacing:.5px">Workers</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:left;text-transform:uppercase;letter-spacing:.5px">Dates</th>
                        <th style="padding:3px 8px;font-size:10px;font-weight:600;color:#aaa;text-align:left;text-transform:uppercase;letter-spacing:.5px">Impact</th>
                    </tr>
                </thead>
                <tbody>${rows_html}</tbody>
            </table>
            ${conflict_html}
        </div>`;

    frm.dashboard.add_section(html, __('Staffing Overview'));
}
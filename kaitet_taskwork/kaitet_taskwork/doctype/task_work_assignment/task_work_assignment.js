// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

frappe.ui.form.on('Task Work Assignment', {
    setup: function(frm) {
        frm._worker_list = [];   // Task Worker names from the linked Plan
    },

    refresh: function(frm) {
        set_stage_indicator(frm);
        render_connections(frm);
        set_child_queries(frm);

        if (frm.doc.docstatus === 0) {
            // Smart Auto-Assign button
            frm.add_custom_button(__('Auto Assign Workers'), () => auto_assign_workers(frm))
                .addClass('btn-primary');

            frm.add_custom_button(__('Smart Assign'), () => perform_smart_assign(frm));

            frm.add_custom_button(__('Calculate Payments'), () => calculate_payments(frm));
            
            frm.add_custom_button(__('Validate Schedule'), () => validate_schedule(frm));
            
            frm.add_custom_button(__('Add Employee'), () => request_employee_change(frm, 'Add Employee'));

            if (frm.fields_dict['worker_assignments']) {
                frm.fields_dict['worker_assignments'].grid.add_custom_button(
                    __('Replace Selected'), () => {
                        const selected = frm.fields_dict['worker_assignments'].grid.get_selected_children();
                        if (!selected.length) {
                            frappe.msgprint(__('Select a row in the Worker Assignments table first.'));
                            return;
                        }
                        request_employee_change(frm, 'Replace Employee', selected[0].employee_name);
                    }
                );
            }
        }

        // Load worker list from plan
        if (frm.doc.task_work_plan) {
            load_worker_list(frm);
        }
        
        // Show payment summary if available
        if (frm.doc.total_estimated_cost > 0) {
            frm.dashboard.add_indicator(
                __('Total Payment: {0}', [format_currency(frm.doc.total_estimated_cost)]),
                'blue'
            );
        }
        
        // Show assignment count
        let assignment_count = (frm.doc.worker_assignments || []).length;
        if (assignment_count > 0) {
            frm.dashboard.add_indicator(
                __('{0} assignments', [assignment_count]),
                'green'
            );
        }
    },

    task_work_plan: function(frm) {
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
            callback: function(r) {
                if (!r.message) return;
                const plan = r.message;

                // Workers may be in task_worker (newer) or employee_name (older)
                frm._worker_list = [...new Set(
                    (plan.entries || []).map(e => e.task_worker || e.employee_name).filter(Boolean)
                )];

                // Auto-populate linked fields
                if (plan.task_work_request_ref && !frm.doc.task_work_request) {
                    frm.set_value('task_work_request', plan.task_work_request_ref);
                }
                if (plan.managers_name && !frm.doc.farm_manager) {
                    frm.set_value('farm_manager', plan.managers_name);
                }
                if (!frm.doc.start_date && plan.custom_expected_start_date) {
                    frm.set_value('start_date', plan.custom_expected_start_date);
                }

                // Inherit business_unit and cost_centre from the plan
                if (plan.business_unit) frm.set_value('business_unit', plan.business_unit);
                if (plan.cost_centre) frm.set_value('cost_centre', plan.cost_centre);

                set_child_queries(frm);
                
                frappe.show_alert({
                    message: __('Loaded {0} workers from plan', [frm._worker_list.length]),
                    indicator: 'green'
                }, 3);
            }
        });
    },

    task_work_request: function(frm) {
        if (!frm.doc.task_work_request) return;

        // Use the request name directly as the title
        frm.set_value('title', frm.doc.task_work_request);

        // Populate task_details table
        populate_tasks_from_request(frm);
    },

    start_date: function(frm) {
        if (frm.doc.start_date && frm.doc.expected_end_date) {
            let days = frappe.datetime.get_diff(frm.doc.expected_end_date, frm.doc.start_date) + 1;
            if (days > 0) {
                frm.set_value('expected_duration', days);
            }
        }
    },

    validate: function(frm) {
        if (!validate_achievement_totals(frm)) {
            return false;
        }
        if (!validate_worker_conflicts(frm)) {
            return false;
        }
        recalc_total_cost(frm);
        return true;
    },

    before_submit: function(frm) {
        // Validate all workers have actual quantities
        let zero_rows = (frm.doc.worker_assignments || [])
            .filter(r => r.quantity_assigned > 0 && (!r.actual_quantity || r.actual_quantity === 0));
            
        if (zero_rows.length > 0) {
            frappe.msgprint({
                title: __('Submission Blocked'),
                message: __('{0} workers have no actual quantity recorded. Please fill in actual work completed before submitting.',
                    [zero_rows.length]),
                indicator: 'orange'
            });
            frappe.validated = false;
            return false;
        }
        
        // Update stage based on completion
        let all_completed = (frm.doc.task_details || []).every(t => t.status === 'Completed');
        if (all_completed) {
            frm.set_value('stage', 'Completed');
        } else {
            frm.set_value('stage', 'In Progress');
        }
    }
});

/* ── Worker Assignments child table ────────────────────────── */
frappe.ui.form.on('Worker Assignments', {
    task: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.task) return;

        // Find the task in task_details for rate / UOM / target
        const td = (frm.doc.task_details || []).find(t => t.task === row.task);
        if (td) {
            frappe.model.set_value(cdt, cdn, 'uom', td.uom);
            frappe.model.set_value(cdt, cdn, 'rate', td.rate);
            frappe.model.set_value(cdt, cdn, 'daily_target', td.daily_target);
        }
    },

    employee_name: function(frm, cdt, cdn) {
        validate_worker_schedule(frm, cdt, cdn);
    },

    quantity_assigned: function(frm, cdt, cdn) {
        recalc_worker_row(frm, cdt, cdn);
        validate_worker_capacity(frm, cdt, cdn);
    },

    actual_quantity: function(frm, cdt, cdn) {
        recalc_worker_row(frm, cdt, cdn);
        update_task_progress(frm, cdt, cdn);
    },

    rate: function(frm, cdt, cdn) {
        recalc_worker_row(frm, cdt, cdn);
    },

    assignment_date: function(frm, cdt, cdn) {
        validate_worker_schedule(frm, cdt, cdn);
    },

    worker_assignments_add: function(frm, cdt, cdn) {
        setTimeout(() => recalc_total_cost(frm), 100);
    },

    worker_assignments_remove: function(frm, cdt, cdn) {
        setTimeout(() => recalc_total_cost(frm), 100);
        setTimeout(() => update_all_task_progress(frm), 200);
    }
});

/* ── Task Details child table ─────────────────────────────── */
frappe.ui.form.on('Task Details', {
    task: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.task) return;
        
        frappe.db.get_value('Task', row.task, 'subject').then(r => {
            frappe.model.set_value(cdt, cdn, 'task_name',
                (r.message && r.message.subject) || row.task);
        });
    }
});

/* ================================================================
   HELPER FUNCTIONS
   ================================================================ */

function load_worker_list(frm) {
    return frappe.call({
        method: 'frappe.client.get',
        args: { doctype: 'Task Work Plan', name: frm.doc.task_work_plan }
    }).then(r => {
        if (r.message) {
            // Workers may be in task_worker (newer) or employee_name (older)
            frm._worker_list = [...new Set(
                (r.message.entries || []).map(e => e.task_worker || e.employee_name).filter(Boolean)
            )];
        }
    });
}

function set_child_queries(frm) {
    // Worker Assignments → employee_name
    // Only show workers from the plan that are not currently assigned elsewhere.
    // Workers whose current_assignment is this document are also included
    // so existing rows remain valid while editing.
    frm.set_query('employee_name', 'worker_assignments', function() {
        const worker_list = frm._worker_list || [];
        if (!worker_list.length) {
            return { filters: [['Task Worker', 'name', '=', '']] };
        }
        // free = no current_assignment, OR current_assignment is this document
        const allowed_assignments = ['', frm.doc.name || ''];
        return {
            filters: [
                ['Task Worker', 'name', 'in', worker_list],
                ['Task Worker', 'current_assignment', 'in', allowed_assignments]
            ]
        };
    });

    // Worker Assignments → task — only tasks already in task_details
    frm.set_query('task', 'worker_assignments', function() {
        const tasks = (frm.doc.task_details || []).map(t => t.task).filter(Boolean);
        if (!tasks.length) {
            return { filters: [['Task', 'name', '=', '']] };
        }
        return { filters: [['Task', 'name', 'in', tasks]] };
    });
}

function populate_tasks_from_request(frm) {
    frappe.call({
        method: 'frappe.client.get',
        args: { doctype: 'Task Work Request', name: frm.doc.task_work_request }
    }).then(r => {
        if (!r.message || !r.message.task_request_details) return;

        frm.clear_table('task_details');

        const items = r.message.task_request_details;
        Promise.all(items.map(item => {
            if (item.task) {
                return frappe.db.get_value('Task', item.task, 'subject')
                    .then(res => ({ 
                        item, 
                        task_name: (res.message && res.message.subject) || item.task 
                    }));
            } else {
                return Promise.resolve({ item, task_name: 'Unnamed Task' });
            }
        })).then(results => {
            results.forEach(({ item, task_name }) => {
                let row = frm.add_child('task_details');
                row.task = item.task;
                row.task_name = task_name;
                row.uom = item.uom;
                row.daily_target = item.daily_target;
                row.rate = item.rate;
                row.total_work = item.total_work;
                row.workers = item.workers;
                row.days = item.days;
                row.estimated_cost = item.estimated_cost;
                row.status = 'Pending';
            });
            
            frm.refresh_field('task_details');
            set_child_queries(frm);
            
            frappe.show_alert({
                message: __('Loaded {0} tasks from request', [items.length]),
                indicator: 'green'
            }, 3);
        });
    });
}

/* ── AUTO-ASSIGN FUNCTION ─────────────────────────────────── */
function auto_assign_workers(frm) {
    if (!frm.doc.task_work_plan) {
        frappe.msgprint(__('Link a Task Work Plan before running Auto Assign.'));
        return;
    }
    
    if (!(frm.doc.task_details || []).length) {
        frappe.msgprint(__('No tasks found. Link a Task Work Request first.'));
        return;
    }
    
    if (!frm.doc.start_date) {
        frappe.msgprint(__('Set a Start Date before running Auto Assign.'));
        return;
    }
    
    let workers = frm._worker_list || [];
    if (!workers.length) {
        frappe.msgprint(__('No workers found in the linked Task Work Plan.'));
        return;
    }
    
    frappe.confirm(
        __('Auto-assign {0} workers to tasks? This will clear all existing assignments.', [workers.length]),
        function() {
            perform_auto_assignment(frm, workers);
        }
    );
}

function perform_auto_assignment(frm, workers) {
    // Clear existing assignments
    frm.clear_table('worker_assignments');
    
    let assignment_plan = [];
    let current_date = new Date(frm.doc.start_date);
    let worker_index = 0;
    let task_progress = {};
    let worker_assignments_per_day = {};
    
    // Sort tasks by start date or priority
    let sorted_tasks = (frm.doc.task_details || []).sort((a, b) => {
        if (a.start_date && b.start_date) {
            return new Date(a.start_date) - new Date(b.start_date);
        }
        return 0;
    });
    
    sorted_tasks.forEach(task => {
        if (!task.total_work || task.total_work <= 0) return;
        
        let total_work = flt(task.total_work);
        let daily_target = flt(task.daily_target) || 1;
        let task_duration = task.days || Math.ceil(total_work / (workers.length * daily_target));
        let workers_per_day = Math.min(Math.ceil(total_work / (daily_target * task_duration)), workers.length);
        
        let work_remaining = total_work;
        let task_start = new Date(current_date);
        let days_used = 0;
        let workers_used = new Set();
        let daily_assignments = [];
        
        // Distribute work across days
        while (work_remaining > 0 && days_used < 30) { // Prevent infinite loop
            let day_date = new Date(task_start);
            day_date.setDate(day_date.getDate() + days_used);
            let date_str = frappe.datetime.obj_to_str(day_date);
            
            // Calculate work for this day
            let available_workers_today = workers_per_day;
            let work_today = Math.min(work_remaining, available_workers_today * daily_target);
            
            if (work_today <= 0) break;
            
            // Get workers for today (round-robin)
            let workers_today = [];
            for (let i = 0; i < available_workers_today && work_remaining > 0; i++) {
                let worker = workers[worker_index % workers.length];
                worker_index++;
                
                // Skip if worker already assigned today (avoid double-booking)
                if (worker_assignments_per_day[date_str] && 
                    worker_assignments_per_day[date_str].includes(worker)) {
                    continue;
                }
                
                workers_today.push(worker);
                
                // Track worker assignment per day
                if (!worker_assignments_per_day[date_str]) {
                    worker_assignments_per_day[date_str] = [];
                }
                worker_assignments_per_day[date_str].push(worker);
                
                let worker_qty = Math.min(daily_target, work_remaining);
                
                // Create assignment
                let row = frm.add_child('worker_assignments');
                row.employee_name = worker;
                row.task = task.task;
                row.uom = task.uom;
                row.daily_target = daily_target;
                row.rate = task.rate;
                row.quantity_assigned = worker_qty;
                row.total_assigned_cost = flt(task.rate * worker_qty, 2);
                row.assignment_date = date_str;
                
                workers_used.add(worker);
                work_remaining -= worker_qty;
                
                daily_assignments.push({
                    worker: worker,
                    quantity: worker_qty
                });
            }
            
            days_used++;
        }
        
        // Move current date forward for next task
        current_date.setDate(current_date.getDate() + days_used);
        
        // Track progress
        task_progress[task.task] = {
            assigned: total_work - work_remaining,
            total: total_work
        };
        
        assignment_plan.push({
            task: task.task_name || task.task,
            workers_needed: task.workers || 1,
            workers_used: workers_used.size,
            total_work: total_work,
            days_planned: days_used,
            completed: Math.round(((total_work - work_remaining) / total_work) * 100)
        });
    });
    
    // Set completion date
    frm.set_value('completion_date', frappe.datetime.obj_to_str(current_date));
    frm.refresh_field('worker_assignments');
    recalc_total_cost(frm);
    
    // Show assignment summary
    show_assignment_summary(frm, assignment_plan);
}

function show_assignment_summary(frm, plan) {
    let total_assignments = (frm.doc.worker_assignments || []).length;
    let unique_workers = new Set((frm.doc.worker_assignments || []).map(w => w.employee_name)).size;
    let total_payment = (frm.doc.worker_assignments || []).reduce((s, w) => s + flt(w.total_assigned_cost), 0);
    
    let html = `
        <div style="padding: 10px;">
            <h4>Auto-Assignment Complete</h4>
            
            <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                <div style="flex: 1; padding: 15px; background-color: #e3f2fd; border-radius: 4px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${total_assignments}</div>
                    <div>Total Assignments</div>
                </div>
                <div style="flex: 1; padding: 15px; background-color: #e8f5e9; border-radius: 4px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${unique_workers}</div>
                    <div>Unique Workers</div>
                </div>
                <div style="flex: 1; padding: 15px; background-color: #fff3e0; border-radius: 4px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${format_currency(total_payment)}</div>
                    <div>Total Payment</div>
                </div>
            </div>
            
            <table class="table table-bordered" style="margin-top: 15px;">
                <thead>
                    <tr>
                        <th>Task</th>
                        <th>Workers Req</th>
                        <th>Workers Used</th>
                        <th>Total Work</th>
                        <th>Days</th>
                        <th>Progress</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    plan.forEach(p => {
        let status_class = p.completed >= 100 ? 'success' : 'warning';
        html += `<tr>
            <td>${p.task}</td>
            <td class="text-center">${p.workers_needed}</td>
            <td class="text-center">${p.workers_used}</td>
            <td class="text-right">${p.total_work}</td>
            <td class="text-center">${p.days_planned}</td>
            <td class="text-${status_class} text-center">${p.completed}%</td>
        </tr>`;
    });
    
    html += `</tbody></table>
        
        <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 4px;">
            <h5>📋 Assignment Notes:</h5>
            <ul>
                <li>Workers have been distributed using round-robin algorithm for fairness</li>
                <li>No worker is assigned to multiple tasks on the same day</li>
                <li>Task durations calculated based on available workforce</li>
                <li>Review assignments and adjust quantities if needed</li>
            </ul>
        </div>
    </div>`;
    
    frappe.msgprint({
        title: __('Assignment Summary'),
        message: html,
        indicator: 'green',
        wide: true
    });
}

function validate_schedule(frm) {
    let conflicts = [];
    let assignments_by_date = {};
    
    (frm.doc.worker_assignments || []).forEach(row => {
        if (!row.assignment_date || !row.employee_name) return;
        
        let key = row.assignment_date + '::' + row.employee_name;
        if (!assignments_by_date[key]) {
            assignments_by_date[key] = [];
        }
        assignments_by_date[key].push(row);
    });
    
    // Check for multiple assignments on same day for same worker
    Object.keys(assignments_by_date).forEach(key => {
        if (assignments_by_date[key].length > 1) {
            let [date, worker] = key.split('::');
            conflicts.push({
                date: date,
                worker: worker,
                count: assignments_by_date[key].length
            });
        }
    });
    
    if (conflicts.length > 0) {
        let html = '<h4>Scheduling Conflicts Found</h4><table class="table table-bordered">';
        html += '<tr><th>Date</th><th>Worker</th><th>Assignments</th></tr>';
        
        conflicts.forEach(c => {
            html += `<tr class="text-danger">
                <td>${c.date}</td>
                <td>${c.worker}</td>
                <td class="text-center">${c.count}</td>
            </tr>`;
        });
        
        html += '</table><p>Please resolve these conflicts before submitting.</p>';
        
        frappe.msgprint({
            title: __('⚠️ Schedule Conflicts'),
            message: html,
            indicator: 'red'
        });
    } else {
        frappe.msgprint({
            title: __('✅ Schedule Valid'),
            message: __('No scheduling conflicts found.'),
            indicator: 'green'
        });
    }
}

function validate_worker_schedule(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.assignment_date || !row.employee_name) return;
    
    // Check if worker is already assigned on this date
    let existing = (frm.doc.worker_assignments || []).filter(r => 
        r.employee_name === row.employee_name && 
        r.assignment_date === row.assignment_date &&
        r.name !== row.name
    );
    
    if (existing.length > 0) {
        frappe.msgprint({
            title: __('⚠️ Scheduling Conflict'),
            indicator: 'orange',
            message: __('Worker {0} is already assigned to another task on {1}', 
                [row.employee_name, row.assignment_date])
        });
        
        // Highlight the conflicting rows
        existing.forEach(r => {
            frappe.utils.highlight_row(r.parent, r.name, 'bg-warning');
        });
        
        return false;
    }
    return true;
}

function validate_worker_capacity(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.quantity_assigned || !row.daily_target) return;
    
    if (row.quantity_assigned > row.daily_target * 1.5) { // Allow 50% buffer
        frappe.msgprint({
            title: __('⚠️ High Workload'),
            indicator: 'orange',
            message: __('Worker {0} assigned quantity ({1}) exceeds daily target ({2}) significantly', 
                [row.employee_name, row.quantity_assigned, row.daily_target])
        });
    }
}

function recalc_worker_row(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    const qty_assigned = flt(row.quantity_assigned);
    const actual_qty = flt(row.actual_quantity);
    const rate = flt(row.rate);

    if (qty_assigned > 0) {
        frappe.model.set_value(cdt, cdn, 'achievement',
            flt((actual_qty / qty_assigned) * 100, 1));
    }

    frappe.model.set_value(cdt, cdn, 'actual_cost', flt(actual_qty * rate, 2));
    frappe.model.set_value(cdt, cdn, 'total_assigned_cost', flt(qty_assigned * rate, 2));
    
    recalc_total_cost(frm);
}

function recalc_total_cost(frm) {
    const total = (frm.doc.worker_assignments || [])
        .reduce((s, r) => s + flt(r.total_assigned_cost), 0);
    frm.set_value('total_estimated_cost', total);
}

function update_task_progress(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.task) return;
    
    // Calculate total progress for this task
    let task_assignments = (frm.doc.worker_assignments || []).filter(r => r.task === row.task);
    let total_assigned = task_assignments.reduce((sum, r) => sum + flt(r.quantity_assigned), 0);
    let total_actual = task_assignments.reduce((sum, r) => sum + flt(r.actual_quantity), 0);
    
    if (total_assigned > 0) {
        let progress = (total_actual / total_assigned) * 100;
        
        // Update task details progress
        let task_detail = (frm.doc.task_details || []).find(t => t.task === row.task);
        if (task_detail) {
            frappe.model.set_value(task_detail.doctype, task_detail.name, 'progress', Math.round(progress));
            
            // Update status based on progress
            if (progress >= 100) {
                frappe.model.set_value(task_detail.doctype, task_detail.name, 'status', 'Completed');
            } else if (progress > 0) {
                frappe.model.set_value(task_detail.doctype, task_detail.name, 'status', 'In Progress');
            }
        }
    }
}

function update_all_task_progress(frm) {
    let tasks = [...new Set((frm.doc.worker_assignments || []).map(r => r.task).filter(Boolean))];
    
    tasks.forEach(task => {
        let task_assignments = (frm.doc.worker_assignments || []).filter(r => r.task === task);
        let total_assigned = task_assignments.reduce((sum, r) => sum + flt(r.quantity_assigned), 0);
        let total_actual = task_assignments.reduce((sum, r) => sum + flt(r.actual_quantity), 0);
        
        if (total_assigned > 0) {
            let progress = (total_actual / total_assigned) * 100;
            
            let task_detail = (frm.doc.task_details || []).find(t => t.task === task);
            if (task_detail) {
                frappe.model.set_value(task_detail.doctype, task_detail.name, 'progress', Math.round(progress));
            }
        }
    });
}

function validate_achievement_totals(frm) {
    if (!frm.doc.worker_assignments || !frm.doc.task_details) return true;

    // Sum actual_quantity per task across all worker rows
    const actual_by_task = {};
    frm.doc.worker_assignments.forEach(r => {
        if (r.task && r.actual_quantity) {
            actual_by_task[r.task] = (actual_by_task[r.task] || 0) + flt(r.actual_quantity);
        }
    });

    const errors = [];
    frm.doc.task_details.forEach(t => {
        const actual = actual_by_task[t.task] || 0;
        const total = flt(t.total_work);
        if (total > 0 && actual > total) {
            errors.push(
                `<b>${t.task_name || t.task}</b>: ` +
                `total actual (${actual.toFixed(2)}) exceeds total work (${total.toFixed(2)}). ` +
                `Reduce work from over-performers.`
            );
        }
    });

    if (errors.length) {
        frappe.msgprint({
            title: __('Total Work Exceeded'),
            message: errors.join('<br><br>'),
            indicator: 'red'
        });
        return false;
    }
    return true;
}

function validate_worker_conflicts(frm) {
    let conflicts = [];
    let assignments_by_day = {};
    
    (frm.doc.worker_assignments || []).forEach(row => {
        if (!row.assignment_date || !row.employee_name) return;
        
        let key = row.assignment_date + '::' + row.employee_name;
        if (!assignments_by_day[key]) {
            assignments_by_day[key] = [];
        }
        assignments_by_day[key].push(row);
    });
    
    Object.keys(assignments_by_day).forEach(key => {
        if (assignments_by_day[key].length > 1) {
            let [date, worker] = key.split('::');
            conflicts.push({
                date: date,
                worker: worker,
                count: assignments_by_day[key].length
            });
        }
    });
    
    if (conflicts.length > 0) {
        let html = '<h4>Scheduling Conflicts</h4><table class="table table-bordered">';
        html += '<tr><th>Date</th><th>Worker</th><th>Assignments</th></tr>';
        
        conflicts.forEach(c => {
            html += `<tr>
                <td>${c.date}</td>
                <td>${c.worker}</td>
                <td class="text-center">${c.count}</td>
            </tr>`;
        });
        
        html += '</table><p>Please resolve these conflicts before submitting.</p>';
        
        frappe.msgprint({
            title: __('Worker Scheduling Conflicts'),
            message: html,
            indicator: 'orange'
        });
        return false;
    }
    return true;
}

function calculate_payments(frm) {
    let payments_by_worker = {};
    let total_payment = 0;
    
    (frm.doc.worker_assignments || []).forEach(row => {
        if (!row.employee_name) return;
        
        let payment = flt(row.actual_cost) || flt(row.total_assigned_cost);
        total_payment += payment;
        
        if (!payments_by_worker[row.employee_name]) {
            payments_by_worker[row.employee_name] = {
                name: row.employee_name,
                total: 0,
                tasks: []
            };
        }
        
        payments_by_worker[row.employee_name].total += payment;
        payments_by_worker[row.employee_name].tasks.push({
            task: row.task,
            amount: payment
        });
    });
    
    // Show payment breakdown
    let html = `
        <div style="padding: 10px;">
            <h4>Payment Summary</h4>
            <p><strong>Total Payment:</strong> ${format_currency(total_payment)}</p>
            <table class="table table-bordered" style="margin-top: 15px;">
                <thead>
                    <tr>
                        <th>Worker</th>
                        <th>Tasks</th>
                        <th>Total Payment</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    Object.values(payments_by_worker).forEach(w => {
        html += `<tr>
            <td>${w.name}</td>
            <td class="text-center">${w.tasks.length}</td>
            <td class="text-right">${format_currency(w.total)}</td>
        </tr>`;
    });
    
    html += `</tbody>
        <tfoot>
            <tr style="font-weight: bold;">
                <td colspan="2">Total</td>
                <td class="text-right">${format_currency(total_payment)}</td>
            </tr>
        </tfoot>
    </table>
    
    <div style="margin-top: 20px;">
        <h5>Payment Details:</h5>
        <ul>
    `;
    
    Object.values(payments_by_worker).forEach(w => {
        html += `<li><strong>${w.name}:</strong> ${format_currency(w.total)} for ${w.tasks.length} tasks</li>`;
    });
    
    html += '</ul></div></div>';
    
    frappe.msgprint({
        title: __('Payment Calculation'),
        message: html,
        width: 700,
        indicator: 'blue'
    });
}

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
        function(vals) {
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
                callback: function(r) {
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

function render_connections(frm) {
    if (frm.is_new()) return;
    const req = frm.doc.task_work_request;
    const plan = frm.doc.task_work_plan;
    if (!req && !plan) return;

    const queries = [];
    if (req) queries.push(frappe.db.get_value('Task Work Request', req, ['title', 'stage']));
    if (plan) queries.push(frappe.db.get_value('Task Work Plan', plan, ['title', 'stage']));

    Promise.all(queries).then(results => {
        let i = 0;
        const req_d = req ? results[i++].message : null;
        const plan_d = plan ? results[i++].message : null;

        const pill = function(stage) {
            const c = { 
                Requested: 'grey', 
                Planned: 'blue', 
                Assigned: 'green',
                'In Progress': 'orange', 
                Completed: 'green', 
                Pending: 'grey' 
            };
            return `<span class="indicator-pill ${c[stage] || 'grey'}"
                    style="font-size:10px;padding:1px 6px;">${stage || ''}</span>`;
        };

        const row = function(label, name, path, stage) {
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span class="text-muted" style="font-size:10px;font-weight:600;min-width:70px;">${label}</span>
                <a href="${path}">${frappe.utils.icon('file', 'xs')} ${name}</a>
                ${pill(stage)}
            </div>`;
        };

        const html = `<div style="padding:4px 0;">
            ${req ? row('REQUEST', req, `/app/task-work-request/${encodeURIComponent(req)}`, req_d && req_d.stage) : ''}
            ${plan ? row('PLAN', plan, `/app/task-work-plan/${encodeURIComponent(plan)}`, plan_d && plan_d.stage) : ''}
        </div>`;

        frm.dashboard.add_section(html, __('Connections'));
    });
}

function set_stage_indicator(frm) {
    const colours = { 
        'Pending': 'grey', 
        'In Progress': 'orange', 
        'Completed': 'green' 
    };
    const stage = frm.doc.stage || 'Pending';
    frm.page.set_indicator(stage, colours[stage] || 'grey');
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
            const day_date      = new Date(task_start);
            day_date.setDate(day_date.getDate() + day);
            const work_today    = Math.min(work_left, max_per_day);
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

    const comp = new Date(current_date);
    comp.setDate(comp.getDate() - 1);
    frm.set_value('completion_date', frappe.datetime.obj_to_str(comp));
    frm.refresh_field('worker_assignments');
    recalc_total_cost(frm);

    const rows = summary.map(s => {
        const diff   = s.actual - s.orig;
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

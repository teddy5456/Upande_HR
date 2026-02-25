// Copyright (c) 2025, Upande and contributors
// For license information, please see license.txt

frappe.ui.form.on("Bulk Overtime Requisition", {
    refresh(frm) {
        // Calculate totals on refresh
        calculate_totals(frm);

        // Show Overtime Claim button only if document is approved and submitted
        if (frm.doc.workflow_state === 'Approved by HR' || frm.doc.workflow_state === 'Approved by General Manager') {
            // Check if Overtime Claim already exists
            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Overtime Claim',
                    filters: {'bulk_request_ref': frm.doc.name},
                    fields: ['name'],
                    limit: 1
                },
                callback: function(r) {
                    if (r.message && r.message.length > 0) {
                        // Claim exists - show view button
                        frm.add_custom_button(__('View Overtime Claim'), function() {
                            frappe.set_route('Form', 'Overtime Claim', r.message[0].name);
                        }, __('Actions'));
                    } else {
                        // No claim exists - show create button
                        frm.add_custom_button(__('Create Overtime Claim'), function() {
                            create_overtime_claim_from_bulk(frm);
                        }, __('Actions'));
                    }
                }
            });
        }
    },

    overtime_period(frm) {
        // Set from_time based on overtime_period selection
        if (frm.doc.overtime_period === 'Lunch Overtime') {
            frm.set_value('from_time', '12:30:00');
        } else if (frm.doc.overtime_period === 'After-Hours Overtime') {
            frm.set_value('from_time', '16:10:00');
        }
        // Clear to_time and hours when period changes
        frm.set_value('to_time', '');
        frm.set_value('hours', '');
    },

    from_time(frm) {
        calculate_to_time(frm);
        calculate_hours(frm);
    },

    hours(frm) {
        calculate_to_time(frm);
        calculate_estimated_cost(frm);
    },

    to_time(frm) {
        calculate_hours(frm);
    },

    hourly_rate(frm) {
        calculate_estimated_cost(frm);
    }
});

// Child table events
frappe.ui.form.on("Overtime Entry", {
    entries_add(frm) {
        calculate_totals(frm);
    },

    entries_remove(frm) {
        calculate_totals(frm);
    }
});

// ============ Time Calculation Functions ============

function format_time(hours, minutes) {
    let hh = String(hours).padStart(2, '0');
    let mm = String(minutes).padStart(2, '0');
    return `${hh}:${mm}:00`;
}

function parse_time(time_string) {
    if (!time_string) return null;
    let parts = time_string.split(':');
    return {
        hours: parseInt(parts[0]),
        minutes: parseInt(parts[1])
    };
}

function calculate_to_time(frm) {
    if (frm.doc.from_time && frm.doc.hours) {
        let from_time = parse_time(frm.doc.from_time);
        if (!from_time) return;

        let total_minutes = from_time.hours * 60 + from_time.minutes + frm.doc.hours * 60;
        let new_hours = Math.floor(total_minutes / 60) % 24;
        let new_minutes = total_minutes % 60;

        frm.set_value("to_time", format_time(new_hours, new_minutes));
    }
}

function calculate_hours(frm) {
    if (frm.doc.from_time && frm.doc.to_time) {
        let from_time = parse_time(frm.doc.from_time);
        let to_time = parse_time(frm.doc.to_time);

        if (!from_time || !to_time) return;

        let from_minutes = from_time.hours * 60 + from_time.minutes;
        let to_minutes = to_time.hours * 60 + to_time.minutes;

        // Handle cases where to_time is next day
        if (to_minutes < from_minutes) {
            to_minutes += 24 * 60;
        }

        let diff_hours = (to_minutes - from_minutes) / 60;
        frm.set_value("hours", diff_hours.toFixed(2));
    }
}

// ============ Cost Estimation Functions ============

function calculate_totals(frm) {
    let total_employees = (frm.doc.entries || []).length;
    frm.set_value('total_employees', total_employees);
    calculate_estimated_cost(frm);
}

function calculate_estimated_cost(frm) {
    let total_employees = frm.doc.total_employees || 0;
    let hours = frm.doc.hours || 0;
    let hourly_rate = frm.doc.hourly_rate || 0;

    let estimated_cost = total_employees * hours * hourly_rate;
    frm.set_value('estimated_cost', estimated_cost);
}

// ============ Overtime Claim Creation ============

function create_overtime_claim_from_bulk(frm) {
    // Count entries
    const entry_count = frm.doc.entries ? frm.doc.entries.length : 0;

    if (entry_count === 0) {
        frappe.msgprint({
            title: __('No Entries'),
            message: __('No overtime entries found to process.'),
            indicator: 'orange'
        });
        return;
    }

    // Show confirmation dialog with breakdown
    let message = `This will create an Overtime Claim for this Bulk OT Requisition with ${entry_count} employees:<br><br>`;
    frm.doc.entries.forEach(entry => {
        message += `<li>${entry.employee_name}: ${frm.doc.hours || 0} hours</li>`;
    });
    message += '<br>Continue?';

    frappe.confirm(
        message,
        function() {
            frappe.call({
                method: 'kaitet_taskwork.kaitet_taskwork.doctype.bulk_overtime_requisition.bulk_overtime_requisition.create_overtime_claim_from_bulk',
                args: {
                    'bulk_requisition_name': frm.doc.name
                },
                freeze: true,
                freeze_message: __('Creating Overtime Claim...'),
                callback: function(r) {
                    if (r.message && r.message.success) {
                        frappe.msgprint({
                            title: __('Success'),
                            message: r.message.message,
                            indicator: 'green'
                        });

                        // Redirect to the created Overtime Claim
                        setTimeout(() => {
                            frappe.set_route('Form', 'Overtime Claim', r.message.claim_name);
                        }, 1500);
                    }
                },
                error: function(r) {
                    frappe.msgprint({
                        title: __('Error'),
                        message: __('Failed to create overtime claim. Please try again.'),
                        indicator: 'red'
                    });
                }
            });
        },
        function() {
            // Cancelled
        }
    );
}

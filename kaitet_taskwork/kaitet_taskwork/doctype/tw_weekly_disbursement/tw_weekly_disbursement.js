frappe.ui.form.on('TW Weekly Disbursement', {
    refresh: function(frm) {
        set_status_indicator(frm);
        setup_week_display(frm);

        // ── Draft: Load Worker Payments ────────────────────────────────
        if (frm.doc.docstatus === 0) {
            frm.add_custom_button(__('Load Worker Payments'), function() {
                load_worker_payments(frm);
            }, __('Actions'));
        }

        // ── Submitted + Pending: Approve ────────────────────────────────
        if (frm.doc.docstatus === 1 && frm.doc.status === 'Pending') {
            frm.add_custom_button(__('Approve'), function() {
                frappe.confirm(
                    __('Approve this disbursement for payment?'),
                    function() {
                        frappe.call({
                            method: 'approve',
                            doc: frm.doc,
                            callback: function() { frm.reload_doc(); }
                        });
                    }
                );
            }, __('Actions'));
        }

        // ── Submitted + Approved: Mark as Paid ─────────────────────────
        if (frm.doc.docstatus === 1 && frm.doc.status === 'Approved') {
            frm.add_custom_button(__('Mark as Paid'), function() {
                frappe.confirm(
                    __('Mark this disbursement as Paid? '
                     + 'This will record the wages expense and lock the payment. '
                     + 'You can still add the payment reference and attachment afterwards.'),
                    function() {
                        frappe.call({
                            method: 'mark_as_paid',
                            doc: frm.doc,
                            callback: function() { frm.reload_doc(); }
                        });
                    }
                );
            }, __('Actions'));
        }

        // ── Paid: info banner (save still enabled for references/attachments) ─
        if (frm.doc.status === 'Paid') {
            let paid_on = frappe.datetime.str_to_user(frm.doc.paid_on);
            let je_link = frm.doc.journal_entry
                ? ` · JE: <a href="/app/journal-entry/${frm.doc.journal_entry}">${frm.doc.journal_entry}</a>`
                : '';
            frm.set_intro(
                `<b>Paid on ${paid_on} by ${frm.doc.paid_by}.</b>${je_link} `
                + `You can still add the payment reference and attach bank confirmation.`,
                'green'
            );
        }
    },

    // ── Button field in the form body ───────────────────────────────────
    get_disbursement_data: function(frm) {
        load_worker_payments(frm);
    },

    year: function(frm) { calculate_week_dates(frm); },
    week_number: function(frm) { calculate_week_dates(frm); },

    company: function(frm) {
        set_account_filters(frm);
        // Auto-populate accounts when company changes
        if (frm.doc.company) {
            frappe.call({
                method: 'kaitet_taskwork.kaitet_taskwork.doctype.tw_weekly_disbursement.tw_weekly_disbursement.get_default_accounts',
                args: { company: frm.doc.company },
                callback: function(r) {
                    if (r.message) {
                        if (r.message.wages_account)
                            frm.set_value('wages_account', r.message.wages_account);
                        if (r.message.accruals_account)
                            frm.set_value('accruals_account', r.message.accruals_account);
                    }
                }
            });
        } else {
            frm.set_value('wages_account', '');
            frm.set_value('accruals_account', '');
        }
    },

    onload: function(frm) {
        set_account_filters(frm);
    }
});

function set_account_filters(frm) {
    let company = frm.doc.company || '';
    frm.set_query('wages_account', function() {
        return {
            filters: {
                company: company,
                root_type: 'Expense',
                is_group: 0
            }
        };
    });
    frm.set_query('payment_account', function() {
        return {
            filters: {
                company: company,
                account_type: ['in', ['Bank', 'Cash']],
                is_group: 0
            }
        };
    });
}

/* ── Shared: load worker payments ─────────────────────────────────────── */
function load_worker_payments(frm) {
    if (!frm.doc.week_start_date || !frm.doc.week_end_date) {
        frappe.msgprint(__('Please set Year and Week Number first.'));
        return;
    }
    frappe.call({
        method: 'get_worker_payments',
        doc: frm.doc,
        freeze: true,
        freeze_message: __('Loading worker payments…'),
        callback: function(r) {
            // frappe.call syncs r.docs to the client model automatically.
            // Refresh fields so the grid renders the newly loaded rows.
            frm.refresh_field('disbursement_entries');
            frm.refresh_field('task_breakdown');
            frm.refresh_field('total_workers');
            frm.refresh_field('total_gross');
            frm.refresh_field('total_deductions');
            frm.refresh_field('total_net');
            // Persist the loaded data to DB
            frm.save();
        }
    });
}

/* ── ISO week → Monday / Sunday dates ─────────────────────────────────── */
function calculate_week_dates(frm) {
    let year = frm.doc.year;
    let week = frm.doc.week_number;
    if (!year || !week || week < 1 || week > 53) return;

    let jan4 = new Date(year, 0, 4);
    let dayOfWeek = (jan4.getDay() + 6) % 7;
    let monday_w1 = new Date(jan4);
    monday_w1.setDate(jan4.getDate() - dayOfWeek);

    let monday = new Date(monday_w1);
    monday.setDate(monday_w1.getDate() + (week - 1) * 7);
    let sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    if (monday.getFullYear() > year || (week > 52 && sunday.getFullYear() < year)) {
        frappe.msgprint(__(`Week ${week} does not exist in ${year}.`));
        frm.set_value('week_start_date', '');
        frm.set_value('week_end_date', '');
        return;
    }

    frm.set_value('week_start_date', frappe.datetime.obj_to_str(monday));
    frm.set_value('week_end_date',   frappe.datetime.obj_to_str(sunday));
}

/* ── Week label in intro bar ─────────────────────────────────────────── */
function setup_week_display(frm) {
    if (frm.doc.week_start_date && frm.doc.week_end_date && frm.doc.status !== 'Paid') {
        let start = frappe.datetime.str_to_user(frm.doc.week_start_date);
        let end   = frappe.datetime.str_to_user(frm.doc.week_end_date);
        frm.set_intro(`Week ${frm.doc.week_number || ''} · ${start} – ${end}`, 'blue');
    }
}

/* ── Status colour indicator ─────────────────────────────────────────── */
function set_status_indicator(frm) {
    const colors = {
        'Draft':     'grey',
        'Pending':   'orange',
        'Approved':  'blue',
        'Paid':      'green',
        'Cancelled': 'red'
    };
    frm.page.set_indicator(frm.doc.status || 'Draft', colors[frm.doc.status] || 'grey');
}

/* ── Child table recalc ──────────────────────────────────────────────── */
frappe.ui.form.on('TW Disbursement Entry', {
    deductions:  function(frm, cdt, cdn) { recalc_row(frm, cdt, cdn); },
    disbursement_entries_remove: function(frm) { recalc_totals(frm); }
});

function recalc_row(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let net = (row.gross_amount || 0) - (row.deductions || 0);
    frappe.model.set_value(cdt, cdn, 'net_amount', net);
    recalc_totals(frm);
}

function recalc_totals(frm) {
    let gross = 0, deductions = 0, net = 0;
    (frm.doc.disbursement_entries || []).forEach(e => {
        gross      += e.gross_amount || 0;
        deductions += e.deductions   || 0;
        net        += e.net_amount   || 0;
    });
    frm.set_value('total_gross',      gross);
    frm.set_value('total_deductions', deductions);
    frm.set_value('total_net',        net);
    frm.set_value('total_workers',    (frm.doc.disbursement_entries || []).length);
}

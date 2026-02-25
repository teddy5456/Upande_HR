// Copyright (c) 2026, Kaitet and contributors
// For license information, please see license.txt

frappe.ui.form.on('Task Worker', {
    onload: function (frm) {
        // Pre-fill Kenya (+254) country code for new records
        if (frm.is_new()) {
            frm.set_value('phone', '+254');
        }
    },
    first_name: function (frm) {
        set_full_name(frm);
    },
    second_name: function (frm) {
        set_full_name(frm);
    },
    last_name: function (frm) {
        set_full_name(frm);
    },
    payment_method: function (frm) {
        toggle_payment_fields(frm);
        // Pre-fill Kenya M-Pesa code when switching to M-Pesa
        if (frm.doc.payment_method === 'M-Pesa' && !frm.doc.mpesa_phone) {
            frm.set_value('mpesa_phone', '+254');
        }
    },
    refresh: function (frm) {
        toggle_payment_fields(frm);

        // Set status indicator colour on the form header
        if (frm.doc.status === 'Active') {
            frm.page.set_indicator('Active', 'green');
        } else if (frm.doc.status === 'Inactive') {
            frm.page.set_indicator('Inactive', 'orange');
        } else if (frm.doc.status === 'Suspended') {
            frm.page.set_indicator('Suspended', 'red');
        }
    }
});

/**
 * Concatenate first, middle and last name and write the result
 * into the read-only full_name field.
 */
function set_full_name(frm) {
    let parts = [frm.doc.first_name, frm.doc.second_name, frm.doc.last_name];
    let full_name = parts.filter(p => p).join(' ');
    frm.set_value('full_name', full_name);
}

/**
 * Show/hide the Banking Details and M-Pesa Details sections
 * based on the selected payment method.
 */
function toggle_payment_fields(frm) {
    let is_bank = frm.doc.payment_method === 'Bank Transfer';
    let is_mpesa = frm.doc.payment_method === 'M-Pesa';

    // Banking fields
    frm.toggle_display('bank_name', is_bank);
    frm.toggle_display('branch_name', is_bank);
    frm.toggle_display('account_number', is_bank);
    frm.toggle_display('account_name', is_bank);

    // M-Pesa fields
    frm.toggle_display('mpesa_phone', is_mpesa);
    frm.toggle_display('mpesa_name', is_mpesa);
}

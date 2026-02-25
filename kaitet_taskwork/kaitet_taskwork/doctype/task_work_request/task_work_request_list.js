frappe.listview_settings['Task Work Request'] = {
	get_indicator: function(doc) {
		const map = {
			'Requested': ['Requested', 'grey',   'stage,=,Requested'],
			'Planned':   ['Planned',   'blue',   'stage,=,Planned'],
			'Assigned':  ['Assigned',  'green',  'stage,=,Assigned']
		};
		return map[doc.stage] || ['Requested', 'grey', ''];
	}
};

frappe.listview_settings['Task Work Plan'] = {
	get_indicator: function(doc) {
		const map = {
			'Planned':     ['Planned',     'blue',   'stage,=,Planned'],
			'Assigned':    ['Assigned',    'orange', 'stage,=,Assigned'],
			'In Progress': ['In Progress', 'yellow', 'stage,=,In Progress'],
			'Completed':   ['Completed',   'green',  'stage,=,Completed']
		};
		return map[doc.stage] || ['Planned', 'blue', ''];
	}
};

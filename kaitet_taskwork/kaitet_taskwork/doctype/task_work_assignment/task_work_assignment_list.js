frappe.listview_settings['Task Work Assignment'] = {
	get_indicator: function(doc) {
		const map = {
			'Pending':     ['Pending',     'grey',   'stage,=,Pending'],
			'In Progress': ['In Progress', 'orange', 'stage,=,In Progress'],
			'Completed':   ['Completed',   'green',  'stage,=,Completed']
		};
		return map[doc.stage] || ['Pending', 'grey', ''];
	}
};

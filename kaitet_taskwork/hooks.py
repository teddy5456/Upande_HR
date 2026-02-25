app_name = "kaitet_taskwork"
app_title = "Upande HR"
app_publisher = "Upande"
app_description = "Upande HR Management System"
app_email = "dev@upande.com"
app_license = "mit"

add_to_apps_screen = [
	{
		"name": "Upande HR",
		"logo": "/assets/kaitet_taskwork/images/logo.png",
		"title": "Upande HR",
		"route": "/app/task-worker",
	}
]

doc_events = {}

fixtures = [
	{
		"dt": "Module Def",
		"filters": [["name", "in", ["Kaitet Taskwork"]]],
	},
	{
		"dt": "Custom Field",
		"filters": [["module", "=", "Kaitet Taskwork"]],
	},
]

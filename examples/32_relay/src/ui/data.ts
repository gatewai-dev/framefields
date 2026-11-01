/** The fictional studio, its client and its work. */
import type { Person } from "./kit.js";

const person = (name: string, tone: string): Person => ({
	name,
	initials: name
		.split(" ")
		.map((w) => w[0])
		.join(""),
	tone,
});

export const DANA = person("Dana Ortiz", "#e9e2d6");
export const MAYA = person("Maya Chen", "#dfe0e6");
export const LEO = person("Leo Park", "#e4e0da");
export const AVA = person("Ava Brooks", "#ece6df");
export const SAM = person("Sam Rivera", "#e2ded6");

export const TEAM = [
	{ person: MAYA, role: "Design" },
	{ person: LEO, role: "Development" },
	{ person: AVA, role: "Content" },
];

export const REQUEST = {
	from: DANA,
	client: "Brightline",
	email: "dana@brightline.co",
	time: "9:41 AM",
	subject: "Homepage update",
	question: "Can we ship the homepage update Friday?",
};

export interface Message {
	from: Person;
	client: string;
	time: string;
	preview: string;
}

/** The rest of the inbox, already read. */
export const MESSAGES: Message[] = [
	{
		from: person("Priya Shah", "#e6e1d9"),
		client: "Northwind",
		time: "8:12 AM",
		preview: "Final logo files are in the shared folder.",
	},
	{
		from: person("Tom Becker", "#dfdcd5"),
		client: "Atlas",
		time: "Yesterday",
		preview: "Thursday works for the kickoff call.",
	},
	{
		from: person("Lena Park", "#e8e3dc"),
		client: "Brightline",
		time: "Yesterday",
		preview: "Added you to the analytics dashboard.",
	},
	{
		from: person("Marco Ruiz", "#e1ddd6"),
		client: "Northwind",
		time: "Mon",
		preview: "Invoice paid, thanks. See you next sprint.",
	},
	{
		from: person("Iris Novak", "#e9e5df"),
		client: "Atlas",
		time: "Mon",
		preview: "Can you share the onboarding checklist?",
	},
	{
		from: person("Owen Hart", "#dedad3"),
		client: "Brightline",
		time: "Fri",
		preview: "Love the new pricing page draft.",
	},
	{
		from: person("Nora Lane", "#e5e0d8"),
		client: "Northwind",
		time: "Fri",
		preview: "Brand guidelines v2 attached.",
	},
	{
		from: person("Theo Grant", "#e2ded8"),
		client: "Atlas",
		time: "Thu",
		preview: "Feedback on the welcome emails.",
	},
];

export const BODY = [
	"Hi team,",
	"The new homepage copy and screenshots are approved on our side.",
	REQUEST.question,
	"",
	"Thanks,",
	"Dana",
];

export const DUE_OPTIONS = [
	{ label: "Today", date: "Wed, Nov 5" },
	{ label: "Tomorrow", date: "Thu, Nov 6" },
	{ label: "Friday", date: "Fri, Nov 7" },
	{ label: "Next week", date: "Mon, Nov 10" },
];
export const FRIDAY = 2;

export const CHECKLIST = [
	"Final copy review",
	"Swap hero screenshots",
	"QA on mobile",
];

export const PROJECTS = [
	"Brightline website",
	"Northwind rebrand",
	"Atlas onboarding",
];

export interface Card {
	title: string;
	owner: Person;
	due: string;
	done: number;
	total: number;
}

export const NEW_CARD: Card = {
	title: "Homepage update",
	owner: MAYA,
	due: "Fri, Nov 7",
	done: 0,
	total: CHECKLIST.length,
};

export const COLUMNS: Array<{ name: string; cards: Card[] }> = [
	{
		name: "Backlog",
		cards: [
			{
				title: "Blog template refresh",
				owner: AVA,
				due: "Nov 18",
				done: 0,
				total: 4,
			},
			{
				title: "Footer link audit",
				owner: LEO,
				due: "Nov 20",
				done: 0,
				total: 2,
			},
			{
				title: "Cookie banner copy",
				owner: AVA,
				due: "Nov 21",
				done: 0,
				total: 1,
			},
		],
	},
	{
		name: "Ready",
		cards: [
			{
				title: "Pricing page tweaks",
				owner: LEO,
				due: "Nov 12",
				done: 0,
				total: 2,
			},
			{
				title: "Case study layout",
				owner: MAYA,
				due: "Nov 14",
				done: 1,
				total: 4,
			},
		],
	},
	{
		name: "In progress",
		cards: [
			{
				title: "Contact form fixes",
				owner: LEO,
				due: "Nov 6",
				done: 2,
				total: 3,
			},
			{
				title: "New team photos",
				owner: AVA,
				due: "Nov 10",
				done: 1,
				total: 2,
			},
		],
	},
	{
		name: "Done",
		cards: [
			{ title: "Analytics setup", owner: LEO, due: "Nov 3", done: 3, total: 3 },
			{
				title: "Hero illustration",
				owner: MAYA,
				due: "Nov 4",
				done: 2,
				total: 2,
			},
		],
	},
];

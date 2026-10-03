export class ModerationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModerationError";
	}
}

export class ModerationUnrefundableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModerationUnrefundableError";
	}
}

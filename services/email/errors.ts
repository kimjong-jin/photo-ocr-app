// services/email/errors.ts
export class EmailError extends Error {
  constructor(public status: number, public payload?: unknown) {
    super(`EmailError(${status})`);
    this.name = 'EmailError';
  }
}

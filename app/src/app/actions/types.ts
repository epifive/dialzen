/** Result shape returned by form Server Actions and consumed with useActionState. */
export interface FormState {
  error?: string;
  success?: string;
}

export const initialFormState: FormState = {};

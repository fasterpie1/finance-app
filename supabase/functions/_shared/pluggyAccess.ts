export const PLUGGY_ALLOWED_EMAIL = 'pajp@hotmail.com';

export function isPluggyAllowedEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === PLUGGY_ALLOWED_EMAIL;
}

import { describe, expect, it } from 'vitest';
import { isPluggyAllowedEmail } from './pluggyAccess';

describe('isPluggyAllowedEmail', () => {
  it('allows only the test account email, ignoring case and whitespace', () => {
    expect(isPluggyAllowedEmail('pajp@hotmail.com')).toBe(true);
    expect(isPluggyAllowedEmail(' PAJP@HOTMAIL.COM ')).toBe(true);
    expect(isPluggyAllowedEmail('other@example.com')).toBe(false);
    expect(isPluggyAllowedEmail(null)).toBe(false);
    expect(isPluggyAllowedEmail(undefined)).toBe(false);
  });
});

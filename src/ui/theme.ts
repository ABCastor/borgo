export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEME_KEY = 'borgo:theme';
export function themeChoice(value: string | null): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return choice === 'system' ? 'light' : choice === 'light' ? 'dark' : 'system';
}
export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.style.colorScheme = choice === 'system' ? 'light dark' : choice;
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-label', `Theme: ${choice}. Switch to ${nextTheme(choice)}`);
    button.setAttribute('aria-pressed', String(choice !== 'system'));
  });
}
export function cycleTheme(): void {
  const choice = nextTheme(themeChoice(document.documentElement.dataset.themeChoice ?? null));
  applyTheme(choice);
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* Storage is optional. */ }
}

import { expect, test, type Page } from '@playwright/test';

/**
 * Mini-DSL de parcours utilisateur : une liste d'étapes déclaratives plutôt
 * que du Playwright impératif dupliqué d'un flux à l'autre. `runJourney`
 * l'interprète avec les locators Playwright standard (`getByRole`,
 * `getByText`) — aucune réinvention du moteur de sélection.
 */
export type Step =
  | { goto: string }
  | { click: string }
  | { expectRoute: string }
  | { expectText: string }
  | { fill: { label: string; value: string } }
  | { waitForVisible: string }
  | { waitForHidden: string };

function stepLabel(step: Step): string {
  const [kind, value] = Object.entries(step)[0] as [string, unknown];
  return `${kind}(${typeof value === 'string' ? value : JSON.stringify(value)})`;
}

/**
 * Exécute chaque étape sous `test.step()` : un échec pointe l'étape en cause
 * dans le rapport Playwright, pas juste un timeout générique.
 */
export async function runJourney(page: Page, steps: Step[]): Promise<void> {
  for (const step of steps) {
    await test.step(stepLabel(step), () => runStep(page, step));
  }
}

async function runStep(page: Page, step: Step): Promise<void> {
  if ('goto' in step) {
    await page.goto(step.goto);
    return;
  }
  if ('click' in step) {
    await page.getByRole('button', { name: step.click, exact: true }).click();
    return;
  }
  if ('expectRoute' in step) {
    await expect.poll(() => new URL(page.url()).hash || '#/').toBe(step.expectRoute);
    return;
  }
  if ('expectText' in step) {
    await expect(page.getByText(step.expectText, { exact: false }).first()).toBeVisible();
    return;
  }
  if ('fill' in step) {
    await page.getByLabel(step.fill.label).fill(step.fill.value);
    return;
  }
  if ('waitForVisible' in step) {
    await page.locator(step.waitForVisible).first().waitFor({ state: 'visible' });
    return;
  }
  await page.locator(step.waitForHidden).first().waitFor({ state: 'hidden' });
}

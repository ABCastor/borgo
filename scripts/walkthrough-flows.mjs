import assert from 'node:assert/strict';

/** Consumer journeys. No direct writes to browser profile storage. */
export async function extraFlows(page, { baseline = false, capture = async () => {} } = {}) {
  const profile = () => page.evaluate(() => JSON.parse(localStorage.getItem('borgo:profile:v1')));
  const showSide = async () => {
    const fold = page.locator('[data-act="fold"]');
    if (await fold.isVisible() && await fold.getAttribute('aria-expanded') !== 'true') await fold.click();
  };
  await page.locator('[data-act="household"]').first().click();
  await page.locator('[data-act="add-person"][data-label="Partner"]').click();
  assert.equal((await profile()).household.length, 2);
  await page.keyboard.press('Escape');
  await page.evaluate(() => location.hash = '#/money');
  await page.waitForSelector('[data-act="add-earner"]', { state: 'attached' });
  await showSide();
  await page.locator('[data-act="add-earner"][data-label="Partner"]').click();
  const peopleAfterPay = (await profile()).household.length;
  assert.equal(peopleAfterPay, baseline ? 3 : 2, 'adding pay to an existing partner must not append another person');
  if (!baseline) { await page.locator('#pay-1').scrollIntoViewIfNeeded(); await capture('partner-pay'); }
  await page.locator('[data-act="household"]').first().click();
  while (await page.locator('#pop [data-act="remove-person"]').count()) await page.locator('#pop [data-act="remove-person"]').last().click();
  assert.equal((await profile()).household.length, 1);
  if (!baseline) {
    await page.locator('#p0-pass').selectOption('IT');
    await page.locator('#pop summary').filter({ hasText: 'How hard to get in' }).click();
    await page.locator('#p0-entry-GB').selectOption('gb-skilled');
    assert.equal((await profile()).household[0].entryRoutes.GB, 'gb-skilled');
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => location.hash = '#/');
  await page.waitForSelector('#wg-money', { state: 'attached' });
  await showSide();
  if (await page.locator('[data-act="more"]').getAttribute('aria-expanded') !== 'true') await page.locator('[data-act="more"]').click();
  await page.locator('.priority-catalogue > button').click();
  await page.locator('[data-act="add-priority"][data-id="own"]').click();
  await page.locator('form.addline input').fill('Family nearby');
  await page.locator('form.addline button').click();
  const personal = (await profile()).personal[0];
  assert.equal(personal.label, 'Family nearby');
  await page.evaluate(() => location.hash = '#/compare');
  await page.waitForSelector(`[data-act="score"][data-line="${personal.id}"]`);
  const rating = page.locator(`[data-act="score"][data-line="${personal.id}"][data-v="5"]`).first();
  const ratedCity = await rating.getAttribute('data-city');
  await rating.click();
  await page.reload();
  await page.waitForSelector(`[data-act="score"][data-line="${personal.id}"][aria-checked="true"]`);
  assert.equal((await profile()).personal[0].scores[ratedCity], 5, 'own rating survives reload');
  if (!baseline) { await page.locator(`[data-act="score"][data-line="${personal.id}"][aria-checked="true"]`).scrollIntoViewIfNeeded(); await capture('own-rating'); }
  if (!baseline) {
    await showSide();
    const ownWeight = (await profile()).weights[personal.id];
    await page.locator('[data-act="remove-priority"][data-id="own"]').click();
    assert.equal((await profile()).weights[personal.id], 0);
    assert.equal((await profile()).personal[0].scores[ratedCity], 5);
    await page.locator('[data-act="undo-priority"]').click();
    assert.equal((await profile()).weights[personal.id], ownWeight);
    await page.locator('[data-act="remove-priority"][data-id="own"]').click();
    await page.reload();
    await page.waitForSelector('[data-act="settings"]', { state: 'attached' });
    await showSide();
    await page.locator('.priority-catalogue > button').click();
    await page.locator('[data-act="add-priority"][data-id="own"]').click();
    assert.equal((await profile()).weights[personal.id], ownWeight);
    assert.equal((await profile()).personal[0].scores[ratedCity], 5);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('.bar-tools [data-act="settings"]').click();
    await page.locator('[data-act="assistant-open"]').click();
    await page.locator('[data-act="copy-ai"]').click();
    const copiedPrompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(copiedPrompt.includes('https://borgo.abcastor.com/mcp'));
    await page.locator('[data-act="copy-mcp"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://borgo.abcastor.com/mcp');
    await page.keyboard.press('Escape');
    await showSide();
    if (await page.locator('[data-act="group"][data-id="money"]').getAttribute('aria-expanded') !== 'true') await page.locator('[data-act="group"][data-id="money"]').click();
    const savedWeight = (await profile()).weights.money_left;
    await page.locator('input[data-act="toggle-breaker"][data-id="money_left"]').click();
    assert.ok((await profile()).dealBreakers.includes('money_left'));
    assert.match(await page.locator('.requirements').innerText(), /Money|money/);
    await page.locator('.requirements').scrollIntoViewIfNeeded();
    await capture('required');
    const weatherWeight = (await profile()).weights.nice_days;
    await page.locator('#wg-climate').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.match(await page.locator('.requirements').innerText(), /Money|money/, 'moving another dial cannot put Required back in the score');
    await page.locator('#wg-climate').evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); }, weatherWeight);
    await page.locator('.requirements [data-act="toggle-breaker"][data-id="money_left"]').click();
    assert.equal((await profile()).weights.money_left, savedWeight);
    if (await page.locator('[data-act="more"]').getAttribute('aria-expanded') !== 'true') await page.locator('[data-act="more"]').click();
    await page.locator('.priority-catalogue > button').click();
    await page.locator('[data-act="add-priority"][data-id="stand"]').click();
    const stance = page.locator('[data-stance="politics"]');
    await stance.evaluate(el => { el.value = '3'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('borgo:profile:v1')).weights.politics > 0);
    assert.equal((await profile()).stances.politics, 3);
    await page.locator('[data-stance="politics"]').scrollIntoViewIfNeeded();
    await capture('stance');
    await page.locator('[data-act="suggest"]').click();
    await page.waitForSelector('#pop [data-act="add-known"]');
    assert.equal(await page.locator('#pop [data-act="add-known"]').count(), 5);
    await page.locator('#pop').scrollIntoViewIfNeeded();
    await capture('suggestions');
    const add = page.locator('#pop [data-act="add-known"]').first();
    const id = await add.getAttribute('data-city');
    await add.click();
    assert.ok((await profile()).cities.includes(id));
    await page.locator(`[data-act="remove-city"][data-city="${id}"]`).click();
    // Return to the base weights for the original map charter.
    await page.locator('[data-act="stance-toggle"][data-id="politics"]').click();
  }
  await page.evaluate(() => location.hash = '#/');
  await page.waitForSelector('#wg-money', { state: 'attached' });
  await showSide();
  if (await page.locator('[data-act="more"]').getAttribute('aria-expanded') !== 'true') await page.locator('[data-act="more"]').click();
  if (await page.locator('[data-act="group"][data-id="own"]').getAttribute('aria-expanded') !== 'true') await page.locator('[data-act="group"][data-id="own"]').click();
  await page.locator(`[data-act="remove-line"][data-id="${personal.id}"]`).click();
  assert.ok(!(await profile()).personal.some((l) => l.id === personal.id), 'removing a custom line must not be refused by an orphaned weight');
  assert.equal((await profile()).weights[personal.id], undefined);
  return { peopleAfterPay, ownRatingSurvivesReload: true, extraFlows: baseline ? 'baseline' : 'partner removal, entry route, Required weight restoration, stance auto-enable, suggestions add/remove, custom rating reload, clipboard prompt and URL' };
}

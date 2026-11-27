import { expect } from 'bun:test'
import { chromium } from 'playwright'

export const openProjectPage = async (url) => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(url)
    return {
      page,
      close: () => browser.close(),
      read: (number) => page.waitForFunction((after) => Number(document.querySelector('main')?.dataset.read) >= after, number),
      phase: (name, role, phase) => page.getByRole('article', { name, exact: true })
        .getByText(role + ' · ' + phase, { exact: true }).waitFor(),
      accept: async (proposal) => {
        const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: proposal, exact: true }) })
        await card.getByRole('button', { name: 'Accept', exact: true }).click()
        await card.getByText('Accepted · version 1', { exact: true }).waitFor()
      },
      noSecret: async (secret) => {
        expect(await page.locator('body').innerText()).not.toContain(secret)
      },
    }
  } catch (error) {
    await browser.close()
    throw error
  }
}

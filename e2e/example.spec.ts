import { test, expect } from '@playwright/test'

/**
 * Дымовой тест: главная страница открывается и отдаёт HTML.
 * Замени на реальные сценарии M Glass App (калькуляторы, КП, авторизация и т.д.).
 */
test('главная страница загружается', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.ok()).toBeTruthy()
  await expect(page).toHaveTitle(/.+/)
})

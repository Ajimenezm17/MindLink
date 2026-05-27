import { expect, test } from '@playwright/test'

test('portal paciente carga formulario de acceso', async ({ page }) => {
  await page.goto('/mindlink')
  await expect(page.getByRole('heading', { name: 'Portal de pacientes' }).first()).toBeVisible()
  await expect(page.locator('input[name="email"]').first()).toBeVisible()
  await expect(page.locator('input[name="contrasena"]').first()).toBeVisible()
})

test('portal profesional muestra acceso profesional', async ({ page }) => {
  await page.goto('/mindlink-trabajador')
  await expect(page.getByRole('heading', { name: 'Portal de profesionales' }).first()).toBeVisible()
})

test('portal admin muestra acceso admin', async ({ page }) => {
  await page.goto('/mindlink-admin')
  await expect(page.getByRole('heading', { name: 'Portal de administracion' }).first()).toBeVisible()
})

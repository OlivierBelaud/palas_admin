-- Navigation language captured from the storefront (display locale if available,
-- else browser language). Used by the abandoned-cart campaign to pick the email
-- language instead of trusting the unreliable contacts.locale (Shopify default).
ALTER TABLE carts ADD COLUMN IF NOT EXISTS browser_locale text;

// Cart -> Contact (1:1 cross-module link).
// Created by `ingestCartEvent` whenever a cart event carries an email.
// Lets the admin client page list all carts attached to a contact, and
// the abandoned-cart query join on `contact` data without HogQL.
export default defineLink('cart', 'contact')

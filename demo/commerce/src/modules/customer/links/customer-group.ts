// Customer <-> CustomerGroup (M:N)
export default defineLink(many('customer'), many('customerGroup'))

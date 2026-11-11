const priceFormatter = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 })
const dateFormatter = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' })

export const formatPrice = (price: number) => (price === 0 ? 'Free' : priceFormatter.format(price))

export const formatDate = (timestamp: number) => dateFormatter.format(timestamp)

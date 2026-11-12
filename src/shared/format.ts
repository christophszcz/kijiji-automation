const priceFormatter = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 })
const dateFormatter = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' })
const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export const formatPrice = (price: number) => (price === 0 ? 'Free' : priceFormatter.format(price))

export const formatDate = (timestamp: number) => dateFormatter.format(timestamp)

export const formatDateTime = (timestamp: number) => dateTimeFormatter.format(timestamp)
